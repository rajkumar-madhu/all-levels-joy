"""Integration tests against a real PostgreSQL 16 with the legacy schema applied.

Needs: POSTGRES_* env pointing at a superuser (the test database is created and dropped), and an
`opa` binary on PATH or OPA_BIN for policy tests (they are skipped otherwise).
"""

import itertools
import os
import shutil
import socket
import subprocess
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jwt
import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import rsa
from django.core.management import call_command
from django.db import connection, transaction
from rest_framework.test import APIClient

ISSUER = "http://keycloak.test/realms/itsm"
AUDIENCE = "itsm-api"
SEEDED_ORG = "10000000-0000-0000-0000-000000000001"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        call_command("apply_legacy_schema", verbosity=0)
        call_command("apply_app_schema", verbosity=0)


@pytest.fixture(autouse=True)
def _settings(settings, monkeypatch):
    settings.KEYCLOAK_ISSUER = ISSUER
    settings.KEYCLOAK_AUDIENCE = AUDIENCE
    settings.PAM_MASTER_KEY = "dGVzdC1vbmx5LXZhdWx0LWtleS0zMi1ieXRlcy1sb24="
    settings.PAM_ROTATION_BACKEND = "simulated"

    class _Key:
        key = _KEY.public_key()

    class _Jwks:
        def get_signing_key_from_jwt(self, token):
            return _Key()

    monkeypatch.setattr("apps.core.authentication.jwks_client", lambda: _Jwks())


def make_token(sub: str, email: str, verified: bool = True, audience: str = AUDIENCE) -> str:
    now = datetime.now(UTC)
    claims = {
        "iss": ISSUER,
        "aud": audience,
        "sub": sub,
        "email": email,
        "email_verified": verified,
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    return jwt.encode(claims, _KEY, algorithm="RS256")


def seed(sql: str, params=()):
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone() if cursor.description else None


# 10,000 numbers per test workspace, above the seeded workspace's counters and below 7 digits.
_NUMBER_RANGES = itertools.count(1_000_000, 10_000)


def create_org(name_prefix: str = "Test") -> str:
    org_id = str(uuid.uuid4())
    seed(
        "INSERT INTO public.organizations(id, name, slug) VALUES (%s, %s, %s)",
        [org_id, f"{name_prefix} {org_id[:8]}", f"t-{org_id[:8]}"],
    )
    # Record numbers (INC0001001, ...) are unique across the database while counters are per workspace,
    # so each test workspace numbers from its own range. Ranges come from a counter: random ranges collided
    # often enough across a session to fail tests intermittently. The test database is created per session.
    base = next(_NUMBER_RANGES)
    for prefix in ("INC", "REQ", "CHG", "KB", "PRB", "MI", "SEC"):
        seed(
            "INSERT INTO public.record_counters(organization_id, prefix, current_value) VALUES (%s, %s, %s)",
            [org_id, prefix, base],
        )
    return org_id


@pytest.fixture
def org():
    return create_org()


@pytest.fixture
def make_user():
    def _make(org_id: str, roles=("requester",), email: str | None = None):
        email = email or f"{uuid.uuid4().hex[:10]}@wecrew.in"
        user_id = seed("INSERT INTO auth.users(email, email_confirmed_at) VALUES (%s, now()) RETURNING id", [email])[0]
        seed("INSERT INTO public.profiles(id, display_name) VALUES (%s, %s)", [user_id, email.split("@")[0]])
        seed(
            "INSERT INTO public.memberships(organization_id, user_id, is_active) VALUES (%s, %s, true)",
            [org_id, user_id],
        )
        for role in roles:
            seed(
                "INSERT INTO public.user_roles(organization_id, user_id, role) VALUES (%s, %s, %s)",
                [org_id, user_id, role],
            )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(f'kc-{user_id}', email)}")
        client.user_id = str(user_id)
        return client

    return _make


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def opa_server():
    binary = os.environ.get("OPA_BIN") or shutil.which("opa")
    if not binary:
        pytest.skip("opa binary not found; set OPA_BIN to run policy integration tests")
    port = _free_port()
    policies = Path(__file__).resolve().parent.parent / "policies"
    proc = subprocess.Popen(
        [binary, "run", "--server", f"--addr=127.0.0.1:{port}", str(policies)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            if requests.get(f"{url}/health", timeout=0.2).ok:
                break
        except requests.RequestException:
            time.sleep(0.1)
    yield url
    proc.terminate()
    proc.wait(5)


@pytest.fixture
def opa(opa_server, settings):
    settings.OPA_URL = opa_server
    return opa_server
