import pytest

from .conftest import create_org, seed

pytestmark = pytest.mark.django_db(transaction=True)


def raise_incident(client, org):
    created = client.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": "Checkout 502 after deploys", "description": "Every deploy since Monday", "impact": 2, "urgency": 2},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def create_problem(client, org, **overrides):
    body = {
        "title": "Recurring 502s after deploys",
        "description": "Gateway drops connections during rollouts",
        "impact": 2,
        "urgency": 1,
        **overrides,
    }
    return client.post(f"/api/v1/orgs/{org}/problems", body, format="json")


def test_problem_from_incident_through_known_error_to_resolution(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    incident_id = raise_incident(agent, org)

    created = create_problem(agent, org, fromIncidentId=incident_id, assignToMe=True)
    assert created.status_code == 201, created.content
    problem_id = created.json()["id"]
    assert created.json()["number"].startswith("PRB")
    url = f"/api/v1/orgs/{org}/problems/{problem_id}"

    detail = agent.get(url).json()
    assert detail["priority"] == 2 and detail["assignee_id"] == agent.user_id
    assert [i["id"] for i in detail["incidents"]] == [incident_id]
    assert incident_id not in [c["id"] for c in detail["candidates"]]
    assert seed("SELECT problem_id FROM public.incidents WHERE id = %s", [incident_id])[0] is not None

    known = agent.patch(
        url,
        {
            "expectedUpdatedAt": detail["updated_at"],
            "state": "in_progress",
            "knownError": True,
            "workaround": "Drain the node before deploy",
            "impact": 1,
        },
        format="json",
    ).json()
    assert known["known_error"] is True and known["priority"] == 1 and known["state"] == "in_progress"

    # Editing an old copy is refused instead of overwriting.
    stale = agent.patch(url, {"expectedUpdatedAt": detail["updated_at"], "urgency": 3}, format="json")
    assert stale.status_code == 409

    blocked = agent.patch(url, {"expectedUpdatedAt": known["updated_at"], "state": "resolved"}, format="json")
    assert blocked.status_code == 400 and "root cause" in blocked.json()["detail"]
    resolved = agent.patch(
        url,
        {
            "expectedUpdatedAt": known["updated_at"],
            "state": "resolved",
            "rootCause": "Keep-alive not honoured",
            "resolutionNotes": "Gateway upgraded to 2.4",
        },
        format="json",
    ).json()
    assert resolved["state"] == "resolved" and resolved["resolved_at"]
    reopened = agent.patch(url, {"expectedUpdatedAt": resolved["updated_at"], "state": "open"}, format="json").json()
    assert reopened["resolved_at"] is None

    listed = agent.get(f"/api/v1/orgs/{org}/problems?knownError=true").json()["results"]
    assert [p["id"] for p in listed] == [problem_id] and listed[0]["incident_count"] == 1
    actions = seed(
        "SELECT array_agg(action ORDER BY created_at) FROM public.audit_events WHERE record_id = %s", [problem_id]
    )[0]
    assert actions == ["created", "updated", "updated", "updated"]


def test_link_and_unlink_incidents(org, make_user, opa):
    agent = make_user(org, roles=("requester", "fulfiller"))
    problem_id = create_problem(agent, org).json()["id"]
    incident_id = raise_incident(agent, org)
    url = f"/api/v1/orgs/{org}/problems/{problem_id}/incidents"

    linked = agent.post(url, {"incidentId": incident_id, "linked": True}, format="json").json()
    assert [i["id"] for i in linked["incidents"]] == [incident_id]
    assert agent.post(url, {"incidentId": incident_id, "linked": True}, format="json").status_code == 200
    unlinked = agent.post(url, {"incidentId": incident_id, "linked": False}, format="json").json()
    assert unlinked["incidents"] == []
    assert seed("SELECT problem_id FROM public.incidents WHERE id = %s", [incident_id])[0] is None


def test_known_error_article_link(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    problem = create_problem(agent, org).json()
    article = agent.post(
        f"/api/v1/orgs/{org}/knowledge",
        {
            "title": "Workaround: drain before deploy",
            "content": "Drain the node, then deploy.",
            "category": "Platform",
            "status": "published",
        },
        format="json",
    ).json()
    url = f"/api/v1/orgs/{org}/problems/{problem['id']}"
    current = agent.get(url).json()
    linked = agent.patch(
        url, {"expectedUpdatedAt": current["updated_at"], "knowledgeArticleId": article["id"]}, format="json"
    ).json()
    assert linked["knowledge_article_number"] == article["number"]


def test_problems_are_staff_only_and_running_needs_problem_roles(org, make_user, opa):
    requester = make_user(org)
    cab = make_user(org, roles=("requester", "cab_member"))
    assert requester.get(f"/api/v1/orgs/{org}/problems").status_code == 403
    assert cab.get(f"/api/v1/orgs/{org}/problems").status_code == 200
    assert create_problem(cab, org).status_code == 403


def test_cannot_link_incidents_from_another_workspace(org, make_user, opa):
    other = create_org("Other")
    outsider_incident = raise_incident(make_user(other), other)
    agent = make_user(org, roles=("requester", "service_desk"))
    assert create_problem(agent, org, fromIncidentId=outsider_incident).status_code == 400
    problem_id = create_problem(agent, org).json()["id"]
    response = agent.post(
        f"/api/v1/orgs/{org}/problems/{problem_id}/incidents",
        {"incidentId": outsider_incident, "linked": True},
        format="json",
    )
    assert response.status_code == 400
