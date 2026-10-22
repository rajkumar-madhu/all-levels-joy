import uuid
from types import SimpleNamespace

import psycopg
import pymysql
import pytest
from django.conf import settings as django_settings
from winrm.exceptions import InvalidCredentialsError

from apps.pam.rotation import RotationError, Target
from apps.pam.rotation.database import MysqlRotator, PostgresRotator
from apps.pam.rotation.live import LiveRotator
from apps.pam.rotation.windows import WindowsRotator

from .conftest import seed
from .test_pam import base, create_secret


@pytest.fixture
def pg_account(settings):
    """A real login role on the test server, rotated over TCP like a remote database."""
    settings.PAM_DB_SSLMODE = "prefer"
    settings.PAM_DB_DEFAULT_DATABASE = "postgres"
    name = f"pam_rot_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(_admin_dsn(), autocommit=True) as conn:
        conn.execute(psycopg.sql.SQL("CREATE ROLE {} LOGIN PASSWORD 'Old-pass-1'").format(psycopg.sql.Identifier(name)))
    yield Target(
        host=django_settings.DATABASES["default"]["HOST"] or "localhost",
        port=int(django_settings.DATABASES["default"]["PORT"] or 5432),
        username=name,
        template="database",
        database_engine="postgresql",
    )
    with psycopg.connect(_admin_dsn(), autocommit=True) as conn:
        conn.execute(psycopg.sql.SQL("DROP ROLE {}").format(psycopg.sql.Identifier(name)))


def _admin_dsn() -> str:
    db = django_settings.DATABASES["default"]
    return psycopg.conninfo.make_conninfo(
        host=db["HOST"] or "localhost",
        port=db["PORT"] or 5432,
        user=db["USER"],
        password=db["PASSWORD"],
        dbname="postgres",
    )


def test_postgres_rotator_changes_a_real_password(pg_account):
    rotator = PostgresRotator()
    assert rotator.verify(pg_account, "Old-pass-1") is True
    rotator.rotate(pg_account, "Old-pass-1", "New-pass-2'; DROP ROLE x; --")
    assert rotator.verify(pg_account, "Old-pass-1") is False
    assert rotator.verify(pg_account, "New-pass-2'; DROP ROLE x; --") is True
    with pytest.raises(RotationError, match="Could not sign in"):
        rotator.rotate(pg_account, "Old-pass-1", "Another-3")


class FakeMysqlServer:
    def __init__(self, password, refuse=None):
        self.password = password
        self.refuse = refuse
        self.statements = []

    def __call__(self, host, port, user, password, **kwargs):
        if password != self.password:
            raise pymysql.err.OperationalError(1045, "Access denied")
        server = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, statement, params):
                server.statements.append((statement, params))
                if server.refuse:
                    raise pymysql.err.OperationalError(1819, server.refuse)
                server.password = params[0]

        return SimpleNamespace(cursor=Cursor, close=lambda: None)


MYSQL = Target("db.example.test", 3306, "app", "database", "mysql")


def test_mysql_rotator_changes_and_verifies():
    server = FakeMysqlServer("old")
    rotator = MysqlRotator()
    rotator.connect = server
    rotator.rotate(MYSQL, "old", "New-pass-9")
    assert server.statements == [("ALTER USER CURRENT_USER() IDENTIFIED BY %s", ["New-pass-9"])]
    assert rotator.verify(MYSQL, "New-pass-9") and not rotator.verify(MYSQL, "old")


def test_mysql_rotator_reports_policy_failures():
    rotator = MysqlRotator()
    rotator.connect = FakeMysqlServer("old", refuse="Your password does not satisfy the current policy requirements")
    with pytest.raises(RotationError, match="policy requirements"):
        rotator.rotate(MYSQL, "old", "short")


class FakeWinrmHost:
    def __init__(self, password, status=0, stderr=b""):
        self.password = password
        self.status = status
        self.stderr = stderr
        self.scripts = []
        self.kwargs = None

    def __call__(self, endpoint, auth, **kwargs):
        self.endpoint, self.kwargs = endpoint, kwargs
        host = self
        if auth[1] != self.password:

            class Refused:
                def run_ps(self, script):
                    raise InvalidCredentialsError("401")

                run_cmd = run_ps

            return Refused()

        class Session:
            def run_ps(self, script):
                host.scripts.append(script)
                if host.status == 0:
                    host.password = "New-pass-9"
                return SimpleNamespace(status_code=host.status, std_err=host.stderr)

            def run_cmd(self, command):
                return SimpleNamespace(status_code=0, std_err=b"")

        return Session()


WINDOWS = Target("win-01.example.test", 5986, r"WIN-01\svc_backup", "windows")


def test_windows_rotator_quotes_passwords_and_validates_tls():
    host = FakeWinrmHost("it's-old")
    rotator = WindowsRotator()
    rotator.session_factory = host
    rotator.rotate(WINDOWS, "it's-old", "New-pass-9")
    assert host.endpoint == "https://win-01.example.test:5986/wsman"
    assert host.kwargs["server_cert_validation"] == "validate" and host.kwargs["transport"] == "ntlm"
    script = host.scripts[0]
    assert "'WinNT://./' + 'svc_backup' + ',user'" in script
    assert "ChangePassword('it''s-old', 'New-pass-9')" in script


def test_windows_rotator_reports_failures():
    rotator = WindowsRotator()
    rotator.session_factory = FakeWinrmHost("old", status=1, stderr=b"Exception calling ChangePassword: policy\r\n")
    with pytest.raises(RotationError, match="Password change failed.*policy"):
        rotator.rotate(WINDOWS, "old", "x")
    rotator.session_factory = FakeWinrmHost("other")
    with pytest.raises(RotationError, match="refused"):
        rotator.rotate(WINDOWS, "old", "x")
    assert rotator.verify(WINDOWS, "old") is False


def test_live_rotator_dispatches_by_template():
    live = LiveRotator()
    with pytest.raises(RotationError, match="API keys"):
        live.rotate(Target("api.example.test", 443, "key", "api_key"), "a", "b")
    with pytest.raises(RotationError, match="database engine"):
        live.verify(Target("db.example.test", 5432, "app", "database"), "a")


@pytest.mark.django_db(transaction=True)
def test_database_secrets_need_an_engine(org, make_user, opa):
    custodian = make_user(org, roles=("requester", "manager"))
    missing = create_secret(custodian, org, name="orders db", template="database", port=5432)
    assert missing.status_code == 400 and "databaseEngine" in missing.json()
    created = create_secret(custodian, org, name="orders db", template="database", databaseEngine="mysql", port=3306)
    assert created.status_code == 201 and created.json()["database_engine"] == "mysql"
    # Switching away from database clears the engine; the database constraint holds either way.
    changed = custodian.patch(
        f"{base(org)}/secrets/{created.json()['id']}",
        {"expectedUpdatedAt": created.json()["updated_at"], "template": "ssh"},
        format="json",
    ).json()
    assert changed["template"] == "ssh" and changed["database_engine"] is None
    assert seed("SELECT database_engine FROM public.pam_secrets WHERE id = %s", [changed["id"]])[0] is None
