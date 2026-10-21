from datetime import UTC, datetime, timedelta

import pytest

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)

PLAN = "Documented in the runbook RB-42"


def catalog_item(org, approval_required=True, name="New laptop"):
    return str(
        seed(
            "INSERT INTO public.catalog_items(organization_id, name, category, description, delivery_days, "
            "approval_required, active) VALUES (%s, %s, 'Hardware', 'Standard developer laptop', 5, %s, true) "
            "RETURNING id",
            [org, name, approval_required],
        )[0]
    )


def test_request_needs_independent_approval_before_fulfilment(org, make_user, opa):
    requester = make_user(org)
    manager = make_user(org, roles=("requester", "manager"))
    fulfiller = make_user(org, roles=("requester", "fulfiller"))
    item = catalog_item(org)
    base = f"/api/v1/orgs/{org}"

    assert [i["id"] for i in requester.get(f"{base}/catalog").json()["results"]] == [item]
    created = requester.post(
        f"{base}/requests",
        {"catalogItemId": item, "title": "Laptop for new starter", "description": "Starts on Monday in Pune"},
        format="json",
    )
    assert created.status_code == 201, created.content
    request_id = created.json()["id"]

    detail = requester.get(f"{base}/requests/{request_id}").json()
    assert (detail["state"], detail["approval_status"]) == ("pending", "requested")
    assert {a["approver_id"] for a in detail["approvals"]} == {manager.user_id}

    # Requesters cannot move requests; OPA refuses before the database is touched.
    patch = {"state": "in_progress", "expectedUpdatedAt": detail["updated_at"]}
    assert requester.patch(f"{base}/requests/{request_id}", patch, format="json").status_code == 403

    queue = manager.get(f"{base}/approvals").json()["results"]
    assert [(a["record_type"], a["record_number"]) for a in queue] == [("request", created.json()["number"])]
    reject_without_notes = manager.post(
        f"{base}/approvals/{queue[0]['id']}/decision", {"decision": "rejected"}, format="json"
    )
    assert reject_without_notes.status_code == 400
    assert manager.post(f"{base}/approvals/{queue[0]['id']}/decision", {"decision": "approved"}, format="json").json()
    approved = fulfiller.get(f"{base}/requests/{request_id}").json()
    assert approved["approval_status"] == "approved"

    stale = {"state": "in_progress", "expectedUpdatedAt": detail["updated_at"]}
    assert fulfiller.patch(f"{base}/requests/{request_id}", stale, format="json").status_code == 409
    fresh = {"state": "in_progress", "expectedUpdatedAt": approved["updated_at"]}
    moved = fulfiller.patch(f"{base}/requests/{request_id}", fresh, format="json")
    assert moved.status_code == 200, moved.content
    assert moved.json()["state"] == "in_progress"


def test_requests_needing_approval_fail_without_an_independent_approver(org, make_user, opa):
    requester = make_user(org)
    response = requester.post(
        f"/api/v1/orgs/{org}/requests",
        {"catalogItemId": catalog_item(org), "title": "Laptop for new starter", "description": "Starts Monday"},
        format="json",
    )
    assert response.status_code == 400
    assert "independent approver" in response.json()["detail"]


def change_body(**overrides):
    start = datetime.now(UTC) - timedelta(minutes=5)
    body = {
        "title": "Patch OpenSSL on api-gateway",
        "description": "Apply vendor patch",
        "changeType": "normal",
        "risk": "medium",
        "implementationPlan": PLAN,
        "testPlan": PLAN,
        "rollbackPlan": PLAN,
        "businessJustification": PLAN,
        "impactAssessment": PLAN,
        "expectedOutageMinutes": 10,
        "affectedCiIds": [],
        "validationPlan": PLAN,
        "rollbackTrigger": PLAN,
        "communicationPlan": PLAN,
        "startAt": start.isoformat(),
        "endAt": (start + timedelta(hours=1)).isoformat(),
    }
    return {**body, **overrides}


def test_change_lifecycle_follows_cab_approval(org, make_user, opa):
    engineer = make_user(org, roles=("requester", "fulfiller"))
    change_manager = make_user(org, roles=("requester", "change_manager"))
    base = f"/api/v1/orgs/{org}/changes"

    naive = engineer.post(base, change_body(startAt="2030-01-01T10:00:00", endAt="2030-01-01T11:00:00"), format="json")
    assert naive.status_code == 400
    created = engineer.post(base, change_body(), format="json")
    assert created.status_code == 201, created.content
    change_id = created.json()["id"]
    actions = f"{base}/{change_id}/actions"

    # Engineers cannot drive the lifecycle; change managers can, but only after approval.
    assert engineer.post(actions, {"action": "start"}, format="json").status_code == 403
    blocked = change_manager.post(actions, {"action": "start"}, format="json")
    assert blocked.status_code == 400 and "approved" in blocked.json()["detail"]

    [approval] = change_manager.get(f"/api/v1/orgs/{org}/approvals").json()["results"]
    change_manager.post(
        f"/api/v1/orgs/{org}/approvals/{approval['id']}/decision", {"decision": "approved"}, format="json"
    )
    assert change_manager.get(f"{base}/{change_id}").json()["approval_status"] == "approved"

    started = change_manager.post(actions, {"action": "start"}, format="json")
    assert started.status_code == 200, started.content
    assert started.json()["state"] == "in_progress"
    incomplete = change_manager.post(actions, {"action": "deliver", "deliveryOutcome": "successful"}, format="json")
    assert incomplete.status_code == 400
    delivered = change_manager.post(
        actions,
        {
            "action": "deliver",
            "deliveryOutcome": "successful",
            "validationResults": "TLS scan clean",
            "pirNotes": "No issues",
            "rollbackUsed": False,
        },
        format="json",
    )
    assert delivered.json()["state"] == "resolved"
    assert change_manager.post(actions, {"action": "cancel"}, format="json").status_code == 400
    assert change_manager.post(actions, {"action": "close"}, format="json").json()["state"] == "closed"


def test_requesters_cannot_raise_changes(org, make_user, opa):
    assert make_user(org).post(f"/api/v1/orgs/{org}/changes", change_body(), format="json").status_code == 403
