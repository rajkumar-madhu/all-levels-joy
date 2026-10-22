"""Service-role operations on vaulted passwords: rotation, verification and the event log.

The caller's role cannot read `ciphertext` or write `pam_events`. Views check access as the caller
first (RLS, pam_is_custodian, request ownership), then step into the service role here for the part
that needs it, and step back.
"""

import json
from contextlib import contextmanager
from datetime import datetime, timedelta

from django.utils import timezone

from apps.core.db import act_as_service, act_as_user, execute, fetch_one

from . import crypto
from .rotation import RotationError, Target, get_rotator

# Retry a failed scheduled rotation after this long instead of on every beat.
RETRY_AFTER = timedelta(hours=1)
RECENT_USE = timedelta(days=7)
STALE_PASSWORD = timedelta(days=90)


@contextmanager
def service_role(user_id: str | None):
    """Run the block as service_role, then return to the caller. On error the transaction is rolled back
    anyway, so the role is only restored on success."""
    act_as_service()
    yield
    if user_id:
        act_as_user(user_id)


def log_event(org_id, action: str, *, secret_id=None, secret_name=None, request_id=None, actor_id=None, detail=None):
    execute(
        "INSERT INTO public.pam_events(organization_id, secret_id, secret_name, request_id, actor_id, action, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)",
        [
            str(org_id),
            str(secret_id) if secret_id else None,
            secret_name,
            str(request_id) if request_id else None,
            str(actor_id) if actor_id else None,
            action,
            json.dumps(detail or {}, default=str),
        ],
    )


def _locked_secret(secret_id) -> dict | None:
    return fetch_one(
        "SELECT id, organization_id, name, host, port, username, template, ciphertext, rotation_enabled, "
        "rotation_interval_days FROM public.pam_secrets WHERE id = %s FOR UPDATE",
        [str(secret_id)],
    )


def _target(row: dict) -> Target:
    return Target(host=row["host"], port=row["port"], username=row["username"], template=row["template"])


def store_password(row: dict, password: str) -> None:
    """Write a new vault copy and restart the rotation clock. Service role."""
    execute(
        "UPDATE public.pam_secrets SET ciphertext = %s, key_version = %s, password_changed_at = now(), "
        "last_rotation_error = NULL, next_rotation_at = CASE WHEN rotation_enabled "
        "THEN now() + make_interval(days => rotation_interval_days) END WHERE id = %s",
        [crypto.encrypt(password, row["organization_id"], row["id"]), crypto.KEY_VERSION, str(row["id"])],
    )


def rotate(secret_id, actor_id: str | None, trigger: str) -> dict:
    """Change the password on the target and in the vault. Service role. Failures are recorded, not raised."""
    row = _locked_secret(secret_id)
    if not row:
        return {"ok": False, "error": "Secret not found."}
    new = crypto.generate_password()
    try:
        current = crypto.decrypt(row["ciphertext"], row["organization_id"], row["id"])
        get_rotator().rotate(_target(row), current, new)
    except (RotationError, crypto.VaultError) as error:
        execute(
            "UPDATE public.pam_secrets SET last_rotation_error = %s, next_rotation_at = CASE WHEN rotation_enabled "
            "THEN now() + %s END WHERE id = %s",
            [str(error), RETRY_AFTER, str(row["id"])],
        )
        log_event(
            row["organization_id"],
            "rotation_failed",
            secret_id=row["id"],
            secret_name=row["name"],
            actor_id=actor_id,
            detail={"trigger": trigger, "error": str(error)},
        )
        return {"ok": False, "error": str(error)}
    store_password(row, new)
    log_event(
        row["organization_id"],
        "rotated",
        secret_id=row["id"],
        secret_name=row["name"],
        actor_id=actor_id,
        detail={"trigger": trigger},
    )
    return {"ok": True}


def verify(secret_id, actor_id: str | None) -> dict:
    """Check the vaulted password still signs in. Service role."""
    row = _locked_secret(secret_id)
    if not row:
        return {"ok": False, "error": "Secret not found."}
    error = None
    try:
        ok = get_rotator().verify(_target(row), crypto.decrypt(row["ciphertext"], row["organization_id"], row["id"]))
    except (RotationError, crypto.VaultError) as failure:
        ok, error = False, str(failure)
    execute(
        "UPDATE public.pam_secrets SET last_verified_at = now(), last_verification_ok = %s WHERE id = %s",
        [ok, str(row["id"])],
    )
    log_event(
        row["organization_id"],
        "verified" if ok else "verification_failed",
        secret_id=row["id"],
        secret_name=row["name"],
        actor_id=actor_id,
        detail={"error": error} if error else {},
    )
    return {"ok": ok, "error": error or (None if ok else "The vaulted password was refused by the host.")}


def assess(row: dict, now: datetime | None = None) -> tuple[str, list[str]]:
    """Risk level and the reasons behind it, for the secrets list and detail advice."""
    now = now or timezone.now()
    reasons = []
    never_rotated = row["password_changed_at"] is None
    used_recently = bool(row["last_used_at"] and row["last_used_at"] >= now - RECENT_USE)
    if never_rotated and used_recently:
        reasons.append("Used in the last 7 days but never rotated.")
    elif never_rotated:
        reasons.append("Never rotated since it was vaulted.")
    elif row["password_changed_at"] < now - STALE_PASSWORD:
        reasons.append("Password is older than 90 days.")
    if row["last_verification_ok"] is False:
        reasons.append("Last verification failed: the vault copy may not match the host.")
    if row["last_rotation_error"]:
        reasons.append("Last rotation failed.")
    if row["rotation_enabled"] and row["next_rotation_at"] and row["next_rotation_at"] < now - RETRY_AFTER:
        reasons.append("Scheduled rotation is overdue.")
    # Never verifying is worth showing but does not raise the level on its own.
    unverified = ["Never verified against the host."] if row["last_verified_at"] is None else []

    failing = row["last_verification_ok"] is False or bool(row["last_rotation_error"])
    if never_rotated and used_recently and row["environment"] == "production":
        level = "critical"
    elif (never_rotated and used_recently) or failing:
        level = "high"
    elif reasons:
        level = "medium"
    else:
        level = "low"
    return level, reasons + unverified
