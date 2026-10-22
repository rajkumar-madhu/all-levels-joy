from datetime import timedelta

import paramiko
import pytest
from django.db import IntegrityError, ProgrammingError, connection, transaction
from django.utils import timezone

from apps.core import policy
from apps.pam import crypto, tasks
from apps.pam.rotation import RotationError, Target
from apps.pam.rotation.ssh import SshRotator

from .conftest import create_org, seed

pytestmark = pytest.mark.django_db(transaction=True)


def base(org):
    return f"/api/v1/orgs/{org}/pam"


def create_secret(client, org, **overrides):
    body = {
        "name": "app-01 root",
        "host": "app-01.example.test",
        "username": "root",
        "environment": "production",
        "folder": "Linux",
        "password": "Initial-pass-1",
        **overrides,
    }
    return client.post(f"{base(org)}/secrets", body, format="json")


@pytest.fixture
def team(org, make_user):
    return {
        "custodian": make_user(org, roles=("requester", "manager")),
        "second": make_user(org, roles=("requester", "admin")),
        "engineer": make_user(org, roles=("requester", "fulfiller")),
        "requester": make_user(org),
    }


def stored_password(secret_id):
    org_id, blob = seed("SELECT organization_id, ciphertext FROM public.pam_secrets WHERE id = %s", [secret_id])
    return crypto.decrypt(blob, org_id, secret_id)


def as_caller(cursor, user_id):
    cursor.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", [user_id])
    cursor.execute("SET LOCAL ROLE authenticated")


def actions(secret_id):
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT action FROM public.pam_events WHERE secret_id = %s ORDER BY id", [secret_id])
        return [row[0] for row in cursor.fetchall()]


def test_encryption_is_bound_to_the_row():
    blob = crypto.encrypt("s3cret", "org-a", "secret-1")
    assert b"s3cret" not in blob
    assert crypto.decrypt(blob, "org-a", "secret-1") == "s3cret"
    with pytest.raises(crypto.VaultError):
        crypto.decrypt(blob, "org-a", "secret-2")
    tampered = blob[:-1] + bytes([blob[-1] ^ 1])
    with pytest.raises(crypto.VaultError):
        crypto.decrypt(tampered, "org-a", "secret-1")


def test_master_key_is_required_outside_debug(settings):
    settings.DEBUG = False
    settings.PAM_MASTER_KEY = None
    with pytest.raises(Exception, match="PAM_MASTER_KEY"):
        crypto.encrypt("x", "o", "s")
    settings.PAM_MASTER_KEY = "c2hvcnQ="
    with pytest.raises(Exception, match="32 bytes"):
        crypto.encrypt("x", "o", "s")


def test_generated_passwords_mix_character_classes():
    for _ in range(20):
        value = crypto.generate_password()
        assert len(value) == 24
        assert any(c.isupper() for c in value) and any(c.islower() for c in value) and any(c.isdigit() for c in value)


def test_requesters_are_denied_and_rls_backs_up_policy(org, team, monkeypatch, opa):
    assert team["requester"].get(f"{base(org)}/secrets").status_code == 403
    created = create_secret(team["custodian"], org)
    assert created.status_code == 201, created.content
    # Even if policy wrongly allowed it, RLS hides secrets from non-staff.
    monkeypatch.setattr(policy, "evaluate", lambda *args: True)
    assert team["requester"].get(f"{base(org)}/secrets").json()["results"] == []
    # And a non-custodian cannot create one.
    assert create_secret(team["engineer"], org, name="other").status_code == 403


def test_ciphertext_is_never_readable_by_callers(org, team, opa):
    secret_id = create_secret(team["custodian"], org).json()["id"]
    body = team["custodian"].get(f"{base(org)}/secrets/{secret_id}").json()
    assert "ciphertext" not in body and "password" not in body
    with (
        pytest.raises(ProgrammingError, match="permission denied|row-level security"),
        transaction.atomic(),
        connection.cursor() as cursor,
    ):
        as_caller(cursor, team["custodian"].user_id)
        cursor.execute("SELECT ciphertext FROM public.pam_secrets")
    # Callers cannot forge log entries either.
    with (
        pytest.raises(ProgrammingError, match="permission denied|row-level security"),
        transaction.atomic(),
        connection.cursor() as cursor,
    ):
        as_caller(cursor, team["custodian"].user_id)
        cursor.execute("INSERT INTO public.pam_events(organization_id, action) VALUES (%s, 'revealed')", [org])


def test_events_are_append_only(org, team, opa):
    secret_id = create_secret(team["custodian"], org).json()["id"]
    with pytest.raises(ProgrammingError, match="cannot be changed"):
        seed("DELETE FROM public.pam_events WHERE secret_id = %s", [secret_id])
    # Deleting the secret keeps its history.
    assert team["custodian"].delete(f"{base(org)}/secrets/{secret_id}").status_code == 204
    assert actions(secret_id) == ["created", "deleted"]


def test_production_secrets_always_need_approval(org, team, opa):
    refused = create_secret(team["custodian"], org, approvalRequired=False)
    assert refused.status_code == 400 and "approvalRequired" in refused.json()
    created = create_secret(team["custodian"], org, environment="uat", approvalRequired=False).json()
    moved = team["custodian"].patch(
        f"{base(org)}/secrets/{created['id']}",
        {"expectedUpdatedAt": created["updated_at"], "environment": "production"},
        format="json",
    )
    assert moved.status_code == 400


def test_access_request_approval_reveal_and_check_in(org, team, opa, settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    custodian, engineer = team["custodian"], team["engineer"]
    secret = create_secret(custodian, org, rotateAfterCheckout=True).json()
    secret_id = secret["id"]

    too_long = engineer.post(
        f"{base(org)}/requests",
        {"secretId": secret_id, "reason": "Patch OpenSSL on app-01", "durationMinutes": 600},
        format="json",
    )
    assert too_long.status_code == 400
    created = engineer.post(
        f"{base(org)}/requests",
        {
            "secretId": secret_id,
            "reason": "Patch OpenSSL on app-01",
            "ticketReference": "CHG0001",
            "durationMinutes": 60,
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    request_id = created.json()["id"]
    assert created.json()["status"] == "pending"
    mine = engineer.get(f"{base(org)}/secrets/{secret_id}").json()
    assert mine["my_request"]["id"] == request_id and mine["is_custodian"] is False
    duplicate = engineer.post(
        f"{base(org)}/requests",
        {"secretId": secret_id, "reason": "Patch OpenSSL on app-01", "durationMinutes": 60},
        format="json",
    )
    assert duplicate.status_code == 400

    # Nothing to reveal before approval.
    assert engineer.post(f"{base(org)}/requests/{request_id}/reveal").status_code == 403
    # Engineers cannot approve, and the custodian queue shows the request.
    assert engineer.post(f"{base(org)}/requests/{request_id}/decision", {"decision": "approve"}).status_code == 403
    queue = custodian.get(f"{base(org)}/requests?scope=approvals").json()["results"]
    assert [r["id"] for r in queue] == [request_id]
    approved = custodian.post(
        f"{base(org)}/requests/{request_id}/decision", {"decision": "approve"}, format="json"
    ).json()
    assert approved["status"] == "approved" and approved["expires_at"]

    # Someone else cannot use the approval.
    assert team["second"].post(f"{base(org)}/requests/{request_id}/reveal").status_code == 403
    revealed = engineer.post(f"{base(org)}/requests/{request_id}/reveal")
    assert revealed.status_code == 200
    assert revealed.json()["password"] == "Initial-pass-1"
    assert revealed["Cache-Control"] == "no-store"

    checked_in = engineer.post(f"{base(org)}/requests/{request_id}/check-in").json()
    assert checked_in["status"] == "checked_in" and checked_in["reveal_count"] == 1
    # The revealed password rotated after check-in.
    assert stored_password(secret_id) != "Initial-pass-1"
    assert engineer.post(f"{base(org)}/requests/{request_id}/reveal").status_code == 403
    assert actions(secret_id) == [
        "created",
        "access_requested",
        "access_approved",
        "revealed",
        "checked_in",
        "rotated",
    ]
    detail = custodian.get(f"{base(org)}/secrets/{secret_id}").json()
    assert detail["password_changed_at"] and detail["last_used_at"]


def test_custodian_cannot_approve_their_own_request(org, team, opa):
    custodian = team["custodian"]
    secret_id = create_secret(custodian, org).json()["id"]
    request_id = custodian.post(
        f"{base(org)}/requests",
        {"secretId": secret_id, "reason": "Emergency database fix", "durationMinutes": 30},
        format="json",
    ).json()["id"]
    own = custodian.post(f"{base(org)}/requests/{request_id}/decision", {"decision": "approve"}, format="json")
    assert own.status_code == 403
    # The database refuses it too.
    with pytest.raises(IntegrityError, match="independent_approver"):
        seed(
            "UPDATE public.pam_access_requests SET approver_id = requester_id, status = 'approved' WHERE id = %s",
            [request_id],
        )
    rejected = team["second"].post(
        f"{base(org)}/requests/{request_id}/decision", {"decision": "reject", "notes": "Use the runbook"}, format="json"
    )
    assert rejected.json()["status"] == "rejected"
    again = team["second"].post(f"{base(org)}/requests/{request_id}/decision", {"decision": "approve"}, format="json")
    assert again.status_code == 409


def test_requests_cannot_be_inserted_already_approved(org, team, opa):
    secret_id = create_secret(team["custodian"], org).json()["id"]
    with (
        pytest.raises(ProgrammingError, match="permission denied|row-level security"),
        transaction.atomic(),
        connection.cursor() as cursor,
    ):
        as_caller(cursor, team["engineer"].user_id)
        cursor.execute(
            "INSERT INTO public.pam_access_requests(organization_id, secret_id, requester_id, reason, "
            "duration_minutes, status, starts_at, expires_at) VALUES (%s, %s, auth.uid(), 'self approved access', "
            "60, 'approved', now(), now() + interval '1 hour')",
            [org, secret_id],
        )


def test_no_approval_secrets_open_at_once_and_expire(org, team, opa):
    secret_id = create_secret(
        team["custodian"], org, name="uat db", environment="uat", approvalRequired=False, template="database"
    ).json()["id"]
    created = (
        team["engineer"]
        .post(
            f"{base(org)}/requests",
            {"secretId": secret_id, "reason": "Load test data refresh", "durationMinutes": 15},
            format="json",
        )
        .json()
    )
    assert created["status"] == "approved"
    assert team["engineer"].post(f"{base(org)}/requests/{created['id']}/reveal").status_code == 200

    # Move the window into the past: reveal is refused and the job closes it.
    seed(
        "UPDATE public.pam_access_requests SET starts_at = now() - interval '2 hours', "
        "expires_at = now() - interval '1 hour' WHERE id = %s",
        [created["id"]],
    )
    assert team["engineer"].post(f"{base(org)}/requests/{created['id']}/reveal").status_code == 403
    listed = team["engineer"].get(f"{base(org)}/requests?scope=mine").json()["results"]
    assert listed[0]["status"] == "expired"
    assert tasks.expire_access() >= 1
    assert seed("SELECT status FROM public.pam_access_requests WHERE id = %s", [created["id"]])[0] == "expired"


def test_cancel_only_pending(org, team, opa):
    secret_id = create_secret(team["custodian"], org).json()["id"]
    request_id = (
        team["engineer"]
        .post(
            f"{base(org)}/requests",
            {"secretId": secret_id, "reason": "Check cron output", "durationMinutes": 30},
            format="json",
        )
        .json()["id"]
    )
    assert team["second"].post(f"{base(org)}/requests/{request_id}/cancel").status_code == 403
    assert team["engineer"].post(f"{base(org)}/requests/{request_id}/cancel").json()["status"] == "cancelled"
    assert team["engineer"].post(f"{base(org)}/requests/{request_id}/cancel").status_code == 409


def test_risk_summary_filters_and_bulk_actions(org, team, opa):
    custodian = team["custodian"]
    prod = create_secret(custodian, org, name="prod web").json()["id"]
    dr = create_secret(custodian, org, name="dr web", environment="dr").json()["id"]
    create_secret(custodian, org, name="uat web", environment="uat")
    seed(
        "UPDATE public.pam_secrets SET last_used_at = now() - interval '1 day' WHERE id = ANY(%s::uuid[])", [[prod, dr]]
    )

    listed = custodian.get(f"{base(org)}/secrets").json()
    risks = {r["name"]: r["risk"] for r in listed["results"]}
    assert risks == {"prod web": "critical", "dr web": "high", "uat web": "medium"}
    assert listed["results"][0]["name"] == "prod web"
    assert listed["summary"]["used_never_rotated"] == 2
    assert listed["summary"]["never_verified"] == 3
    assert listed["environment_counts"] == {"all": 3, "production": 1, "dr": 1, "uat": 1, "development": 0}
    chip = custodian.get(f"{base(org)}/secrets?usedNeverRotated=true&environment=dr").json()
    assert [r["name"] for r in chip["results"]] == ["dr web"] and chip["environment_counts"]["all"] == 2
    assert custodian.get(f"{base(org)}/secrets?risk=bogus").status_code == 400

    enabled = custodian.post(
        f"{base(org)}/secrets/bulk", {"ids": [prod, dr], "action": "enable_rotation"}, format="json"
    )
    assert enabled.status_code == 200
    # Never rotated, so rotation is due at once; the scheduled job rotates both.
    assert tasks.rotate_due() == 2
    listed = custodian.get(f"{base(org)}/secrets").json()
    assert listed["summary"]["automatic_rotation_pct"] == 67
    assert {r["name"]: r["risk"] for r in listed["results"]}["prod web"] == "low"

    verified = custodian.post(f"{base(org)}/secrets/bulk", {"ids": [prod], "action": "verify"}, format="json").json()
    assert verified["results"][0]["ok"] is True
    moved = custodian.post(
        f"{base(org)}/secrets/bulk", {"ids": [prod, dr], "action": "move", "folder": "Web tier"}, format="json"
    )
    assert moved.status_code == 200
    assert custodian.get(f"{base(org)}/secrets").json()["folders"] == ["Linux", "Web tier"]
    assert team["engineer"].post(f"{base(org)}/secrets/bulk", {"ids": [prod], "action": "verify"}).status_code == 403
    other = create_org()
    assert (
        custodian.post(f"/api/v1/orgs/{other}/pam/secrets/bulk", {"ids": [prod], "action": "verify"}).status_code == 403
    )


def test_versioned_update_and_manual_password(org, team, opa):
    custodian = team["custodian"]
    secret = create_secret(custodian, org).json()
    url = f"{base(org)}/secrets/{secret['id']}"
    updated = custodian.patch(
        url,
        {"expectedUpdatedAt": secret["updated_at"], "rotationEnabled": True, "rotationIntervalDays": 7},
        format="json",
    ).json()
    assert updated["rotation_enabled"] and updated["next_rotation_at"]
    stale = custodian.patch(url, {"expectedUpdatedAt": secret["updated_at"], "folder": "Old"}, format="json")
    assert stale.status_code == 409
    assert team["engineer"].patch(url, {"expectedUpdatedAt": updated["updated_at"], "folder": "X"}).status_code == 403

    set_password = custodian.post(f"{url}/password", {"password": "Changed-by-hand-2"}, format="json")
    assert set_password.status_code == 200 and set_password.json()["password_changed_at"]
    assert stored_password(secret["id"]) == "Changed-by-hand-2"
    assert "Changed-by-hand-2" not in str(
        seed("SELECT detail FROM public.pam_events WHERE secret_id = %s", [secret["id"]])
    )


def test_failed_rotation_is_recorded_and_keeps_the_password(org, team, opa, monkeypatch):
    from apps.pam.rotation.simulated import SimulatedRotator

    def refuse(self, target, current, new):
        raise RotationError("passwd failed on app-01.example.test: Authentication token manipulation error")

    monkeypatch.setattr(SimulatedRotator, "rotate", refuse)
    secret_id = create_secret(team["custodian"], org).json()["id"]
    result = team["custodian"].post(f"{base(org)}/secrets/{secret_id}/rotate").json()
    assert result["ok"] is False and "passwd failed" in result["error"]
    assert result["secret"]["last_rotation_error"] and result["secret"]["risk"] == "high"
    assert stored_password(secret_id) == "Initial-pass-1"
    assert actions(secret_id)[-1] == "rotation_failed"


class FakeChannel:
    def __init__(self, status):
        self.status = status

    def shutdown_write(self):
        pass

    def recv_exit_status(self):
        return self.status


class FakeStream:
    def __init__(self, status=0, text=b""):
        self.channel = FakeChannel(status)
        self.text = text
        self.written = ""

    def write(self, data):
        self.written += data

    def flush(self):
        pass

    def read(self):
        return self.text


class FakeHost:
    """Stands in for paramiko.SSHClient against a host whose password is `password`."""

    def __init__(self, password, passwd_status=0):
        self.password = password
        self.passwd_status = passwd_status
        self.stdin = None

    def __call__(self):
        return self

    def connect(self, host, port, username, password, **kwargs):
        if password != self.password:
            raise paramiko.AuthenticationException("bad password")

    def exec_command(self, command, timeout=None):
        assert command == "passwd"
        self.stdin = FakeStream()
        stderr = FakeStream(text=b"passwd: password is too similar to the old one\n")
        stdout = FakeStream(self.passwd_status)
        return self.stdin, stdout, stderr

    def close(self):
        if self.stdin and self.passwd_status == 0 and self.stdin.written:
            self.password = self.stdin.written.splitlines()[1]


TARGET = Target(host="app-01.example.test", port=22, username="deploy", template="ssh")


def test_ssh_rotator_changes_and_verifies_password():
    host = FakeHost("old-pass")
    rotator = SshRotator()
    rotator.client_factory = host
    assert rotator.verify(TARGET, "old-pass") is True
    assert rotator.verify(TARGET, "wrong") is False
    rotator.rotate(TARGET, "old-pass", "New-pass-9")
    assert host.stdin.written == "old-pass\nNew-pass-9\nNew-pass-9\n"
    assert host.password == "New-pass-9"


def test_ssh_rotator_reports_failures():
    rotator = SshRotator()
    rotator.client_factory = FakeHost("old-pass", passwd_status=1)
    with pytest.raises(RotationError, match="too similar"):
        rotator.rotate(TARGET, "old-pass", "New-pass-9")
    rotator.client_factory = FakeHost("other")
    with pytest.raises(RotationError, match="refused"):
        rotator.rotate(TARGET, "old-pass", "New-pass-9")
    with pytest.raises(RotationError, match="cannot rotate database"):
        rotator.rotate(Target("db", 5432, "app", "database"), "a", "b")


def test_ssh_rotator_refuses_unknown_host_keys(settings):
    settings.PAM_SSH_KNOWN_HOSTS = None
    client = SshRotator.client_factory()
    assert isinstance(client._policy, paramiko.RejectPolicy)


def test_rotation_schedule_waits_for_the_interval(org, team, opa):
    secret = create_secret(team["custodian"], org, rotationEnabled=True, rotationIntervalDays=30).json()
    assert tasks.rotate_due() == 1
    nxt = seed("SELECT next_rotation_at FROM public.pam_secrets WHERE id = %s", [secret["id"]])[0]
    assert nxt > timezone.now() + timedelta(days=29)
    assert tasks.rotate_due() == 0
