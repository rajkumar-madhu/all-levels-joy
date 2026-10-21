import pytest

from apps.core import policy

from .conftest import create_org, seed

pytestmark = pytest.mark.django_db(transaction=True)

PLAN = {
    "impactAssessment": "Public API exposed",
    "fixPlan": "Upgrade OpenSSL to 3.0.15",
    "testPlan": "Run TLS scan after patch",
    "rollbackPlan": "Redeploy previous image",
    "rollbackTrigger": "Handshake failures above 1%",
}


def board(client, org):
    return client.get(f"/api/v1/orgs/{org}/security/board")


def test_requester_is_denied_by_policy(org, make_user, opa):
    assert board(make_user(org), org).status_code == 403


def test_board_rechecks_staff_access_in_database(org, make_user, monkeypatch):
    # Even if the policy layer wrongly allowed it, the database staff check still refuses.
    monkeypatch.setattr(policy, "evaluate", lambda *args: True)
    response = board(make_user(org), org)
    assert response.status_code == 403
    assert "staff only" in response.json()["detail"]


def test_finding_lifecycle_runs_through_database_functions(org, make_user, opa):
    analyst = make_user(org, roles=("requester", "service_desk"))
    manager = make_user(org, roles=("requester", "manager"))
    base = f"/api/v1/orgs/{org}/security"

    created = analyst.post(f"{base}/findings", {"title": "OpenSSL CVE on api-gw", "severity": "high"}, format="json")
    assert created.status_code == 201, created.content
    finding_id = created.json()["id"]

    submitted = analyst.post(f"{base}/findings/{finding_id}/transition", {"action": "submit", **PLAN}, format="json")
    assert submitted.json()["state"] == "pending_approval"

    # Approver role is enforced by the function (42501 -> 403).
    denied = analyst.post(f"{base}/findings/{finding_id}/transition", {"action": "approve"}, format="json")
    assert denied.status_code == 403
    approved = manager.post(f"{base}/findings/{finding_id}/transition", {"action": "approve"}, format="json")
    assert approved.json()["state"] == "scheduled"

    naive = analyst.post(
        f"{base}/findings/{finding_id}/transition",
        {"action": "schedule", "windowStart": "2030-01-01T10:00:00", "windowEnd": "2030-01-01T11:00:00"},
        format="json",
    )
    assert naive.status_code == 400
    scheduled = analyst.post(
        f"{base}/findings/{finding_id}/transition",
        {
            "action": "schedule",
            "windowStart": "2030-01-01T10:00:00+05:30",
            "windowEnd": "2030-01-01T11:00:00Z",
        },
        format="json",
    )
    assert scheduled.status_code == 200, scheduled.content
    assert scheduled.json()["window_start"].startswith("2030-01-01T04:30:00")

    rows = board(analyst, org).json()["findings"]
    assert [r["state"] for r in rows if r["id"] == finding_id] == ["scheduled"]
    audit = seed("SELECT count(*) FROM public.audit_events WHERE record_id = %s", [finding_id])[0]
    assert audit >= 3


def test_staff_cannot_write_findings_table_directly(org, make_user):
    from django.db import connection, transaction

    from apps.core.db import act_as_user

    staff = make_user(org, roles=("requester", "admin"))
    with pytest.raises(Exception, match="permission denied"), transaction.atomic():
        act_as_user(staff.user_id)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE public.security_findings SET state = 'closed' WHERE organization_id = %s", [org])


def test_finding_from_another_workspace_is_not_found(org, make_user, opa):
    other = create_org("Other")
    elsewhere = make_user(str(other), roles=("requester", "service_desk"))
    created = elsewhere.post(
        f"/api/v1/orgs/{other}/security/findings",
        {"title": "Weak TLS on intranet", "severity": "low"},
        format="json",
    )
    staff_here = make_user(org, roles=("requester", "admin"))
    response = staff_here.post(
        f"/api/v1/orgs/{org}/security/findings/{created.json()['id']}/transition",
        {"action": "cancel"},
        format="json",
    )
    assert response.status_code == 404
