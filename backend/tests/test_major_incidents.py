import pytest

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)


def raise_incident(client, org, title="Checkout returning 502 for all users"):
    created = client.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": title, "description": "Started 09:12 after deploy", "impact": 1, "urgency": 1},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def declare(client, org, incident_id, **overrides):
    body = {
        "incidentId": incident_id,
        "severity": 1,
        "situationSummary": "Checkout down for all customers since 09:12",
        "customerImpact": "No orders can be placed",
        "bridgeUrl": "https://meet.example.com/mi-checkout",
        "nextUpdateMinutes": 15,
        **overrides,
    }
    return client.post(f"/api/v1/orgs/{org}/major-incidents", body, format="json")


def test_declare_run_and_resolve_a_bridge(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    manager = make_user(org, roles=("requester", "manager"))
    incident_id = raise_incident(agent, org)
    problem = str(
        seed(
            "INSERT INTO public.problems(organization_id, number, title, description) "
            "VALUES (%s, %s, 'Checkout 502s', 'Recurring 502s after deploys') RETURNING id",
            [org, f"PRB{org[:6]}"],
        )[0]
    )

    declared = declare(agent, org, incident_id)
    assert declared.status_code == 201, declared.content
    major_id = declared.json()["id"]
    assert declared.json()["number"].startswith("MI")
    assert declare(agent, org, incident_id).status_code == 400  # one bridge per incident

    center = manager.get(f"/api/v1/orgs/{org}/command-center").json()
    [major] = center["majors"]
    assert (major["commander_id"], major["escalation_level"], major["bridge_state"]) == (agent.user_id, 3, "declared")
    assert incident_id not in [c["id"] for c in center["candidates"]]
    assert [u["update_type"] for u in center["updates"]] == ["declaration"]
    flagged = seed("SELECT major_incident FROM public.incidents WHERE id = %s", [incident_id])[0]
    assert flagged is True

    url = f"/api/v1/orgs/{org}/major-incidents/{major_id}"
    assert manager.patch(
        url, {"takeComms": True, "bridgeState": "mitigating", "problemId": problem}, format="json"
    ).json()
    assert (
        manager.post(
            f"{url}/updates",
            {"body": "Rolled back deploy 4812", "updateType": "action", "audience": "customer"},
            format="json",
        ).status_code
        == 201
    )
    assert manager.patch(url, {"bridgeState": "resolved"}, format="json").status_code == 200

    major = manager.get(f"/api/v1/orgs/{org}/command-center").json()["majors"][0]
    assert major["comms_lead_id"] == manager.user_id and major["problem_id"] == problem
    assert major["mitigated_at"] and major["resolved_at"] and major["next_update_at"] is None
    assert seed("SELECT problem_id FROM public.incidents WHERE id = %s", [incident_id])[0] is not None
    assert seed("SELECT count(*) FROM public.problem_incidents WHERE incident_id = %s", [incident_id])[0] == 1
    # The bridge resolving does not resolve the ticket; that needs the incident's own evidence.
    assert seed("SELECT state::text FROM public.incidents WHERE id = %s", [incident_id])[0] == "new"
    actions = seed(
        "SELECT array_agg(action ORDER BY created_at) FROM public.audit_events WHERE record_id = %s", [major_id]
    )[0]
    assert actions == ["declared", "updated", "update_posted", "updated"]


def test_only_http_bridge_links_and_active_incidents(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    incident_id = raise_incident(agent, org)
    assert declare(agent, org, incident_id, bridgeUrl="javascript:alert(1)").status_code == 400
    current = agent.get(f"/api/v1/orgs/{org}/incidents/{incident_id}").json()
    agent.patch(
        f"/api/v1/orgs/{org}/incidents/{incident_id}",
        {"expectedUpdatedAt": current["updated_at"], "state": "cancelled"},
        format="json",
    )
    refused = declare(agent, org, incident_id)
    assert refused.status_code == 400 and "Reopen" in refused.json()["detail"]


def test_command_center_is_for_staff_and_running_needs_problem_roles(org, make_user, opa):
    requester = make_user(org)
    cab = make_user(org, roles=("requester", "cab_member"))
    incident_id = raise_incident(make_user(org, roles=("requester", "service_desk")), org)
    assert requester.get(f"/api/v1/orgs/{org}/command-center").status_code == 403
    assert cab.get(f"/api/v1/orgs/{org}/command-center").status_code == 200
    assert declare(cab, org, incident_id).status_code == 403


def test_declaration_rolls_back_when_the_incident_changes_meanwhile(org, make_user, opa, monkeypatch):
    from datetime import timedelta

    from apps.major_incidents import views

    agent = make_user(org, roles=("requester", "service_desk"))
    incident_id = raise_incident(agent, org)
    real_fetch_one = views.fetch_one

    def stale_read(sql, params=()):
        row = real_fetch_one(sql, params)
        if row and "updated_at" in row and "FROM public.incidents" in sql:
            row["updated_at"] -= timedelta(seconds=1)  # someone else saved the incident after our read
        return row

    monkeypatch.setattr(views, "fetch_one", stale_read)
    response = declare(agent, org, incident_id)
    assert response.status_code == 409
    assert seed("SELECT count(*) FROM public.major_incidents WHERE incident_id = %s", [incident_id])[0] == 0
    assert seed("SELECT major_incident FROM public.incidents WHERE id = %s", [incident_id])[0] is False
