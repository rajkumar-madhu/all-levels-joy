import pytest

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)


def raise_incident(client, org, title="Email not syncing on phone"):
    created = client.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": title, "description": "Since this morning", "impact": 2, "urgency": 2},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()


def breached_incident(org, requester_id, group_id):
    return str(
        seed(
            "INSERT INTO public.incidents(organization_id, number, title, description, impact, urgency, requester_id, "
            "group_id, contact_type, sla_due_at) VALUES (%s, %s, 'Payroll export failing', 'Nightly job', 2, 2, %s, "
            "%s, 'self_service', now() - interval '1 hour') RETURNING id",
            [org, f"INC9{org[:6]}", requester_id, group_id],
        )[0]
    )


def test_sla_dashboard_groups_by_team_and_respects_visibility(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    owner, stranger = make_user(org), make_user(org)
    group = str(seed("INSERT INTO public.groups(organization_id, name) VALUES (%s, 'Payroll') RETURNING id", [org])[0])
    incident_id = breached_incident(org, owner.user_id, group)

    staff_view = agent.get(f"/api/v1/orgs/{org}/sla").json()
    payroll = next(t for t in staff_view["teams"] if t["team"] == "Payroll")
    assert (payroll["openIncidents"], payroll["breached"]) == (1, 1)
    assert [b["id"] for b in staff_view["breached"]] == [incident_id]
    assert staff_view["breached"][0]["recordType"] == "incident"

    assert [b["id"] for b in owner.get(f"/api/v1/orgs/{org}/sla").json()["breached"]] == [incident_id]
    assert stranger.get(f"/api/v1/orgs/{org}/sla").json() == {"teams": [], "breached": []}


def test_incident_metrics_count_only_visible_incidents(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    alice, bob = make_user(org), make_user(org)
    raise_incident(alice, org)
    raise_incident(alice, org, "VPN drops hourly")
    raise_incident(bob, org, "Printer offline")

    staff = agent.get(f"/api/v1/orgs/{org}/insights/incidents").json()
    assert (staff["opened"], staff["openTotal"], staff["unassigned"]) == (3, 3, 3)
    assert len(staff["days"]) == 14 and staff["days"][-1]["opened"] == 3
    assert staff["slaAttainment"] is None and staff["mttrHours"] is None
    assert {"label": "self_service", "count": 3} in staff["byContactType"]
    assert alice.get(f"/api/v1/orgs/{org}/insights/incidents").json()["opened"] == 2


def test_activity_timeline_comes_from_database_audit_snapshots(org, make_user, opa):
    requester = make_user(org)
    agent = make_user(org, roles=("requester", "service_desk"))
    incident = raise_incident(requester, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident['id']}"
    current = agent.get(url).json()
    worked = agent.patch(
        url, {"expectedUpdatedAt": current["updated_at"], "assignToMe": True, "state": "in_progress"}, format="json"
    )
    assert worked.status_code == 200, worked.content

    staff = agent.get(f"{url}/activity").json()
    labels = [e["label"] for e in staff["timeline"]]
    assert labels[0] == "Opened" and "Assigned" in labels and "Work started" in labels and "First response" in labels
    assigned = next(e for e in staff["timeline"] if e["label"] == "Assigned")
    assert assigned["personId"] == agent.user_id and assigned["personName"]
    assert staff["slas"] and staff["slas"][0]["state"] in ("Running", "Met")

    # Requesters cannot read the audit log, so they only see recorded times, never invented ones.
    mine = [e["label"] for e in requester.get(f"{url}/activity").json()["timeline"]]
    assert mine == ["Opened", "First response"]


def test_activity_is_hidden_from_other_requesters(org, make_user, opa):
    owner, stranger = make_user(org), make_user(org)
    incident = raise_incident(owner, org)
    assert stranger.get(f"/api/v1/orgs/{org}/incidents/{incident['id']}/activity").status_code == 404
    assert stranger.get(f"/api/v1/orgs/{org}/problems/{incident['id']}/activity").status_code == 404


def test_search_returns_only_records_the_caller_can_read(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    owner, stranger = make_user(org), make_user(org)
    incident = raise_incident(owner, org, "Badge reader broken in lobby")

    found = agent.get(f"/api/v1/orgs/{org}/search", {"q": "badge reader"}).json()
    assert [i["number"] for i in found["incidents"]] == [incident["number"]]
    assert set(found) == {"incidents", "requests", "changes", "knowledge", "assets", "catalog", "security"}
    assert owner.get(f"/api/v1/orgs/{org}/search", {"q": incident["number"]}).json()["incidents"]
    assert stranger.get(f"/api/v1/orgs/{org}/search", {"q": "badge reader"}).json()["incidents"] == []
    # LIKE wildcards in the query are literal.
    assert agent.get(f"/api/v1/orgs/{org}/search", {"q": "%%"}).json()["incidents"] == []
    assert agent.get(f"/api/v1/orgs/{org}/search", {"q": "x"}).status_code == 400
