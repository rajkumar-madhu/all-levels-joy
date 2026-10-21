from datetime import UTC, datetime, timedelta

import pytest

from .conftest import create_org, seed

pytestmark = pytest.mark.django_db(transaction=True)


def service(org, name="Checkout"):
    return str(
        seed(
            "INSERT INTO public.services(organization_id, name, code) VALUES (%s, %s, %s) RETURNING id",
            [org, name, f"{name[:3].upper()}{org[:4]}"],
        )[0]
    )


def group(org, name="Platform"):
    return str(seed("INSERT INTO public.groups(organization_id, name) VALUES (%s, %s) RETURNING id", [org, name])[0])


ASSET = {
    "name": "orders-api-prod",
    "ciClass": "Application",
    "environment": "production",
    "status": "operational",
    "criticality": "high",
    "location": "ap-south-1",
}


# --- Assets & CMDB --------------------------------------------------------------------------------


def test_cmdb_owners_maintain_assets_and_relationships(org, make_user, opa):
    owner = make_user(org, roles=("requester", "cmdb_manager"))
    agent = make_user(org, roles=("requester", "service_desk"))
    svc = service(org)
    base = f"/api/v1/orgs/{org}/assets"

    created = owner.post(base, {**ASSET, "serviceId": svc}, format="json")
    assert created.status_code == 201, created.content
    api = created.json()
    assert (api["service_name"], api["owner_id"]) == ("Checkout", owner.user_id)
    db = owner.post(base, {**ASSET, "name": "orders-db-prod", "ciClass": "Database"}, format="json").json()

    linked = owner.post(
        f"{base}/{api['id']}/relationships", {"childId": db["id"], "relationshipType": "depends_on"}, format="json"
    )
    assert linked.status_code == 201
    [rel] = linked.json()["relationships"]
    assert (rel["parent_name"], rel["child_name"]) == ("orders-api-prod", "orders-db-prod")
    assert (
        owner.post(
            f"{base}/{api['id']}/relationships", {"childId": api["id"], "relationshipType": "runs_on"}, format="json"
        ).status_code
        == 400
    )

    # Staff read; only CMDB owners and admins write.
    listed = agent.get(f"{base}?q=orders").json()["results"]
    assert {r["name"]: r["relationship_count"] for r in listed} == {"orders-api-prod": 1, "orders-db-prod": 1}
    assert agent.post(base, ASSET, format="json").status_code == 403

    stale = owner.patch(
        f"{base}/{api['id']}",
        {**ASSET, "status": "degraded", "expectedUpdatedAt": "2020-01-01T00:00:00Z"},
        format="json",
    )
    assert stale.status_code == 409
    fresh = owner.patch(
        f"{base}/{api['id']}", {**ASSET, "status": "degraded", "expectedUpdatedAt": api["updated_at"]}, format="json"
    )
    assert fresh.json()["status"] == "degraded" and fresh.json()["service_id"] is None

    removed = owner.delete(f"{base}/{api['id']}/relationships/{rel['id']}")
    assert removed.json()["relationships"] == []
    actions = seed(
        "SELECT array_agg(action ORDER BY created_at) FROM public.audit_events WHERE record_id = %s", [api["id"]]
    )[0]
    assert actions == ["created", "relationship_added", "updated", "relationship_removed"]


def test_requesters_cannot_see_assets_but_read_services(org, make_user, opa):
    requester = make_user(org)
    service(org)
    assert requester.get(f"/api/v1/orgs/{org}/assets").status_code == 403
    assert [s["name"] for s in requester.get(f"/api/v1/orgs/{org}/services").json()["results"]] == ["Checkout"]


def test_asset_service_must_belong_to_the_workspace(org, make_user, opa):
    owner = make_user(org, roles=("requester", "admin"))
    foreign = service(create_org("Other"), "Billing")
    response = owner.post(f"/api/v1/orgs/{org}/assets", {**ASSET, "serviceId": foreign}, format="json")
    assert response.status_code == 400


# --- Catalogue administration ---------------------------------------------------------------------


def test_managers_route_and_retire_catalogue_items(org, make_user, opa):
    manager = make_user(org, roles=("requester", "manager"))
    agent = make_user(org, roles=("requester", "service_desk"))
    requester = make_user(org)
    grp = group(org)
    item = str(
        seed(
            "INSERT INTO public.catalog_items(organization_id, name, category, description) "
            "VALUES (%s, 'Monitor', 'Hardware', 'External 27 inch monitor') RETURNING id",
            [org],
        )[0]
    )
    admin_url = f"/api/v1/orgs/{org}/catalog/admin"
    assert agent.get(admin_url).status_code == 403
    [row] = manager.get(admin_url).json()["results"]

    url = f"/api/v1/orgs/{org}/catalog/{item}"
    assert agent.patch(url, {"expectedUpdatedAt": row["updated_at"], "priority": 2}, format="json").status_code == 403
    routed = manager.patch(
        url,
        {"expectedUpdatedAt": row["updated_at"], "groupId": grp, "priority": 2, "approvalRequired": True},
        format="json",
    )
    assert routed.status_code == 200, routed.content
    assert (routed.json()["group_name"], routed.json()["default_priority"], routed.json()["approval_required"]) == (
        "Platform",
        2,
        True,
    )
    assert (
        manager.patch(url, {"expectedUpdatedAt": row["updated_at"], "active": False}, format="json").status_code == 409
    )
    retired = manager.patch(url, {"expectedUpdatedAt": routed.json()["updated_at"], "active": False}, format="json")
    assert retired.json()["active"] is False
    # Retired items leave the requester catalogue but stay in the admin list.
    assert requester.get(f"/api/v1/orgs/{org}/catalog").json()["results"] == []
    assert len(manager.get(admin_url).json()["results"]) == 1


# --- Request tasks --------------------------------------------------------------------------------


def request_for(client, org, approval_required=False):
    item = str(
        seed(
            "INSERT INTO public.catalog_items(organization_id, name, category, description, approval_required) "
            "VALUES (%s, 'Software installation', 'Software', 'Install approved software', %s) RETURNING id",
            [org, approval_required],
        )[0]
    )
    created = client.post(
        f"/api/v1/orgs/{org}/requests",
        {"catalogItemId": item, "title": "Install Figma for design team", "description": "Five seats"},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def test_fulfillers_track_tasks_on_approved_requests(org, make_user, opa):
    requester = make_user(org)
    fulfiller = make_user(org, roles=("requester", "fulfiller"))
    request_id = request_for(requester, org)
    url = f"/api/v1/orgs/{org}/requests/{request_id}/tasks"

    due = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    assert (
        fulfiller.post(url, {"title": "Assign licence", "dueAt": "2030-01-01T10:00:00"}, format="json").status_code
        == 400
    )
    added = fulfiller.post(url, {"title": "Assign licence", "dueAt": due}, format="json")
    assert added.status_code == 201, added.content
    [task] = added.json()["results"]
    assert (task["state"], task["assignee_id"]) == ("open", fulfiller.user_id)

    moved = fulfiller.patch(
        f"{url}/{task['id']}", {"state": "closed", "expectedUpdatedAt": task["updated_at"]}, format="json"
    )
    assert moved.json()["results"][0]["state"] == "closed"
    stale = fulfiller.patch(
        f"{url}/{task['id']}", {"state": "open", "expectedUpdatedAt": task["updated_at"]}, format="json"
    )
    assert stale.status_code == 409

    # Tasks are internal fulfilment work: requesters neither read nor add them.
    assert requester.get(url).status_code == 403
    assert requester.post(url, {"title": "Hurry up"}, format="json").status_code == 403


def test_tasks_wait_for_approval(org, make_user, opa):
    requester = make_user(org)
    make_user(org, roles=("requester", "manager"))
    fulfiller = make_user(org, roles=("requester", "fulfiller"))
    request_id = request_for(requester, org, approval_required=True)
    response = fulfiller.post(
        f"/api/v1/orgs/{org}/requests/{request_id}/tasks", {"title": "Assign licence"}, format="json"
    )
    assert response.status_code == 400 and "approved" in response.json()["detail"]


# --- Change links ---------------------------------------------------------------------------------

PLAN = "Documented in the runbook RB-42"


def standard_change(client, org):
    start = datetime.now(UTC) + timedelta(days=1)
    body = {
        "title": "Rotate TLS certificates",
        "description": PLAN,
        "changeType": "standard",
        "risk": "low",
        "implementationPlan": PLAN,
        "testPlan": PLAN,
        "rollbackPlan": PLAN,
        "businessJustification": PLAN,
        "impactAssessment": PLAN,
        "expectedOutageMinutes": 0,
        "affectedCiIds": [],
        "validationPlan": PLAN,
        "rollbackTrigger": PLAN,
        "communicationPlan": PLAN,
        "startAt": start.isoformat(),
        "endAt": (start + timedelta(hours=1)).isoformat(),
    }
    created = client.post(f"/api/v1/orgs/{org}/changes", body, format="json")
    assert created.status_code == 201, created.content
    return created.json()["id"]


def test_changes_link_to_incidents_and_problems(org, make_user, opa):
    engineer = make_user(org, roles=("requester", "fulfiller"))
    requester = make_user(org)
    change_id = standard_change(engineer, org)
    incident = requester.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": "Certificate warning on portal", "description": "Browser warns", "impact": 2, "urgency": 2},
        format="json",
    ).json()["id"]
    problem = str(
        seed(
            "INSERT INTO public.problems(organization_id, number, title, description) "
            "VALUES (%s, %s, 'Expiring certs', 'No rotation') RETURNING id",
            [org, f"PRB{org[:6]}"],
        )[0]
    )
    url = f"/api/v1/orgs/{org}/changes/{change_id}/links"

    candidates = engineer.get(f"/api/v1/orgs/{org}/change-link-candidates").json()
    assert incident in [i["id"] for i in candidates["incidents"]] and problem in [
        p["id"] for p in candidates["problems"]
    ]
    engineer.post(url, {"recordType": "incident", "recordId": incident}, format="json")
    linked = engineer.post(
        url, {"recordType": "problem", "recordId": problem, "relation": "related"}, format="json"
    ).json()
    assert {(link["record_type"], link["relation"]) for link in linked["links"]} == {
        ("incident", "resolves"),
        ("problem", "related"),
    }
    # Linking twice is a no-op; foreign records are refused.
    assert len(engineer.post(url, {"recordType": "incident", "recordId": incident}, format="json").json()["links"]) == 2
    foreign = create_org("Other")
    other_problem = str(
        seed(
            "INSERT INTO public.problems(organization_id, number, title, description) "
            "VALUES (%s, %s, 'x', 'y') RETURNING id",
            [foreign, f"PRB{foreign[:6]}"],
        )[0]
    )
    assert engineer.post(url, {"recordType": "problem", "recordId": other_problem}, format="json").status_code == 400

    # Staff see which change resolves the incident. Requesters may read the link rows, but changes they did
    # not raise stay hidden by RLS (as in the legacy getIncidentLinks).
    seen = engineer.get(f"/api/v1/orgs/{org}/incidents/{incident}/links").json()
    assert [c["id"] for c in seen["changes"]] == [change_id]
    assert requester.get(f"/api/v1/orgs/{org}/incidents/{incident}/links").json()["changes"] == []
    assert requester.post(url, {"recordType": "incident", "recordId": incident}, format="json").status_code == 403

    link_id = next(link["id"] for link in linked["links"] if link["record_type"] == "problem")
    after = engineer.delete(f"{url}/{link_id}").json()
    assert [link["record_type"] for link in after["links"]] == ["incident"]


# --- Operator-raised incidents and queues ---------------------------------------------------------


def test_operators_raise_routed_incidents(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    requester = make_user(org)
    grp, svc = group(org), service(org)
    body = {
        "title": "Caller reports checkout failures",
        "description": "Customer phoned at 10:05",
        "impact": 1,
        "urgency": 2,
        "groupId": grp,
        "serviceId": svc,
        "category": "software",
        "contactType": "phone",
    }
    created = agent.post(f"/api/v1/orgs/{org}/incidents/operator", body, format="json")
    assert created.status_code == 201, created.content
    detail = agent.get(f"/api/v1/orgs/{org}/incidents/{created.json()['id']}").json()
    assert (detail["group_name"], detail["contact_type"], detail["state"]) == ("Platform", "phone", "new")
    assert requester.post(f"/api/v1/orgs/{org}/incidents/operator", body, format="json").status_code == 403
    assert (
        agent.post(
            f"/api/v1/orgs/{org}/incidents/operator", {**body, "groupId": group(create_org("Other"))}, format="json"
        ).status_code
        == 400
    )


def test_queues_counts_filters_and_paging(org, make_user, opa):
    agent = make_user(org, roles=("requester", "service_desk"))
    grp = group(org)
    base = f"/api/v1/orgs/{org}/incidents"
    ids = []
    for n in range(3):
        created = agent.post(
            f"{base}/operator",
            {
                "title": f"Queue sample incident {n}",
                "description": "Sample",
                "impact": 2,
                "urgency": 2,
                "groupId": grp if n == 0 else None,
            },
            format="json",
        )
        ids.append(created.json()["id"])
    seed("UPDATE public.incidents SET sla_due_at = now() - interval '1 hour' WHERE id = %s", [ids[1]])
    current = agent.get(f"{base}/{ids[2]}").json()
    agent.patch(f"{base}/{ids[2]}", {"expectedUpdatedAt": current["updated_at"], "assignToMe": True}, format="json")

    counts = agent.get(f"{base}/queue-counts").json()
    assert (counts["active"], counts["mine"], counts["unassigned"], counts["breached"]) == (3, 1, 2, 1)

    mine = agent.get(f"{base}?queue=mine").json()
    assert ([r["id"] for r in mine["results"]], mine["total"], mine["page_size"]) == ([ids[2]], 1, 25)
    assert [r["id"] for r in agent.get(f"{base}?queue=breached").json()["results"]] == [ids[1]]
    grouped = agent.get(f"{base}?queue=active&group={grp}").json()["results"]
    assert [(r["id"], r["group_name"]) for r in grouped] == [(ids[0], "Platform")]
    assert agent.get(f"{base}?queue=active&group=unassigned").json()["total"] == 2
    assert agent.get(f"{base}?queue=active&q=incident%201").json()["total"] == 1
    assert agent.get(f"{base}?queue=active&page=2").json()["results"] == []
    assert agent.get(f"{base}?queue=bogus").status_code == 400
    assert agent.get(f"{base}?queue=active&group=nope").status_code == 400
