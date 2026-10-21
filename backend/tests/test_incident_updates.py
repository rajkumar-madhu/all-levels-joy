import pytest

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)


def raise_incident(client, org):
    created = client.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": "Email not syncing on phone", "description": "Since this morning", "impact": 2, "urgency": 2},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def test_operator_works_an_incident_through_hold_resolve_and_reopen(org, make_user, opa):
    requester = make_user(org)
    agent = make_user(org, roles=("requester", "service_desk"))
    group = str(
        seed("INSERT INTO public.groups(organization_id, name) VALUES (%s, 'Messaging') RETURNING id", [org])[0]
    )
    incident_id = raise_incident(requester, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}"

    first = agent.get(url).json()
    taken = agent.patch(
        url,
        {"expectedUpdatedAt": first["updated_at"], "assignToMe": True, "groupId": group, "state": "in_progress"},
        format="json",
    )
    assert taken.status_code == 200, taken.content
    body = taken.json()
    assert (body["state"], body["group_name"], body["assignee_id"]) == ("in_progress", "Messaging", agent.user_id)
    assert body["first_responded_at"] is not None

    # Editing from an old copy is refused instead of overwriting.
    stale = agent.patch(url, {"expectedUpdatedAt": first["updated_at"], "impact": 1}, format="json")
    assert stale.status_code == 409

    no_reason = agent.patch(url, {"expectedUpdatedAt": body["updated_at"], "state": "pending"}, format="json")
    assert no_reason.status_code == 400 and "hold reason" in no_reason.json()["detail"]
    held = agent.patch(
        url,
        {"expectedUpdatedAt": body["updated_at"], "state": "pending", "onHoldReason": "awaiting_caller"},
        format="json",
    ).json()
    assert held["on_hold_reason"] == "awaiting_caller"

    resolved = agent.patch(
        url,
        {
            "expectedUpdatedAt": held["updated_at"],
            "state": "resolved",
            "resolutionNotes": "Re-added the account",
            "closeCode": "solved_remotely",
        },
        format="json",
    ).json()
    assert resolved["state"] == "resolved" and resolved["resolved_at"] and resolved["on_hold_reason"] is None

    reopened = agent.patch(url, {"expectedUpdatedAt": resolved["updated_at"], "state": "open"}, format="json").json()
    assert (reopened["reopen_count"], reopened["resolved_at"]) == (1, None)


def test_requester_cannot_update_incidents(org, make_user, opa):
    requester = make_user(org)
    incident_id = raise_incident(requester, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}"
    current = requester.get(url).json()
    response = requester.patch(url, {"expectedUpdatedAt": current["updated_at"], "state": "cancelled"}, format="json")
    assert response.status_code == 403


def test_internal_notes_are_hidden_from_requesters(org, make_user, opa):
    requester = make_user(org)
    agent = make_user(org, roles=("requester", "service_desk"))
    incident_id = raise_incident(requester, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}/comments"

    assert requester.post(url, {"body": "Still broken after restart"}, format="json").status_code == 201
    assert agent.post(url, {"body": "Looks like the MDM profile", "internal": True}, format="json").status_code == 201
    # Requesters cannot write staff-only notes; RLS refuses the insert.
    assert requester.post(url, {"body": "sneaky", "internal": True}, format="json").status_code == 403

    staff_view = [c["body"] for c in agent.get(url).json()["results"]]
    requester_view = [c["body"] for c in requester.get(url).json()["results"]]
    assert staff_view == ["Still broken after restart", "Looks like the MDM profile"]
    assert requester_view == ["Still broken after restart"]
    audit = seed(
        "SELECT count(*) FROM public.audit_events WHERE record_id = %s AND action = 'comment_added'", [incident_id]
    )[0]
    assert audit == 2


def test_other_requesters_cannot_read_or_comment(org, make_user, opa):
    owner, stranger = make_user(org), make_user(org)
    incident_id = raise_incident(owner, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}/comments"
    assert stranger.get(url).status_code == 404
    assert stranger.post(url, {"body": "hello"}, format="json").status_code == 404
