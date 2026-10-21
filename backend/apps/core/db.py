"""Run SQL as the caller so RLS and the legacy security-definer functions see the right user.

The legacy schema reads the caller from auth.uid(), which reads `request.jwt.claim.sub`. We set that
claim and switch role with transaction-local settings, so nothing survives past the request's
transaction (ATOMIC_REQUESTS is on).
"""

import json
from collections.abc import Sequence
from typing import Any

from django.db import connection
from psycopg.types.json import Jsonb

# Django's PostgreSQL backend loads json/jsonb as text (JSONField decodes it); raw queries decode here.
JSON_TYPE_OIDS = {114, 3802}


def _decode(value: Any, type_oid: int) -> Any:
    return json.loads(value) if type_oid in JSON_TYPE_OIDS and isinstance(value, str) else value


def _require_transaction() -> None:
    if not connection.in_atomic_block:
        raise RuntimeError("Database role switching needs an open transaction")


def act_as_user(user_id: str) -> None:
    _require_transaction()
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, true), set_config('request.jwt.claims', %s, true)",
            [user_id, json.dumps({"sub": user_id, "role": "authenticated"})],
        )
        cursor.execute("SET LOCAL ROLE authenticated")


def act_as_service() -> None:
    """Privileged role for webhooks and scheduled jobs only; it bypasses RLS."""
    _require_transaction()
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)"
        )
        cursor.execute("SET LOCAL ROLE service_role")


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value)


def call_function(name: str, args: Sequence[tuple[str, Any, str]] = ()) -> Any:
    """Call public.<name>(arg => value::type, ...) and return its single result.

    Arguments carry explicit SQL types so overload resolution never depends on how the driver
    guesses Python types (e.g. Python int -> smallint parameters).
    """
    if not name.replace("_", "").isalnum():
        raise ValueError("Invalid function name")
    params = []
    parts = []
    for arg_name, value, sql_type in args:
        if not arg_name.replace("_", "").isalnum() or not sql_type.replace("_", "").isalnum():
            raise ValueError("Invalid argument")
        parts.append(f"{arg_name} => %s::{sql_type}")
        params.append(value)
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT public.{name}({', '.join(parts)})", params)
        return _decode(cursor.fetchone()[0], cursor.description[0].type_code)


def fetch_all(sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [(c.name, c.type_code) for c in cursor.description]
        return [
            {name: _decode(value, oid) for (name, oid), value in zip(columns, row, strict=True)}
            for row in cursor.fetchall()
        ]


def fetch_one(sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def like_pattern(text: str) -> str:
    """`%text%` for ILIKE with the user's own wildcards escaped."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """Run a statement and return the affected row count. Use it where RETURNING would need read access
    the caller lacks (for example, inserting an audit event they may not read back)."""
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.rowcount
