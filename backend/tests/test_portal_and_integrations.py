import pytest
from django.test import Client

from apps.integration_status import probes

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def portal_org(org, settings):
    settings.PORTAL_ORG_ID = org
    settings.PORTAL_EMAIL_DOMAIN = "wecrew.in"
    return org


def submit(client, title="Laptop will not boot"):
    return client.post(
        "/api/v1/portal/tickets",
        {
            "title": title,
            "description": "Black screen after the update",
            "impact": 3,
            "urgency": 2,
            "category": "hardware",
        },
        format="json",
    )


def test_portal_shows_only_my_records_and_public_comments(portal_org, make_user, opa):
    mine, someone = make_user(portal_org), make_user(portal_org)
    created = submit(mine)
    assert created.status_code == 201, created.content
    incident_id = created.json()["id"]
    submit(someone, "Someone else's ticket")
    agent = make_user(portal_org, roles=("requester", "service_desk"))
    for internal in (False, True):
        seed(
            "INSERT INTO public.record_comments(organization_id, record_type, record_id, author_id, body, internal) "
            "VALUES (%s, 'incident', %s, %s, %s, %s)",
            [portal_org, incident_id, agent.user_id, f"note internal={internal}", internal],
        )
    major = seed(
        "INSERT INTO public.major_incidents(organization_id, number, incident_id) VALUES (%s, %s, %s) RETURNING id",
        [portal_org, f"MI{portal_org[:7]}", incident_id],
    )[0]
    for audience in ("customer", "internal"):
        seed(
            "INSERT INTO public.major_incident_updates(organization_id, major_incident_id, body, audience) "
            "VALUES (%s, %s, %s, %s)",
            [portal_org, major, f"{audience} update", audience],
        )

    body = mine.get("/api/v1/portal").json()
    assert body["allowed"] is True
    assert [i["id"] for i in body["incidents"]] == [incident_id]
    assert [(c["body"], c["mine"]) for c in body["comments"]] == [("note internal=False", False)]
    assert [u["body"] for u in body["outageUpdates"]] == ["customer update"]

    reply = mine.post(f"/api/v1/portal/incidents/{incident_id}/replies", {"body": "Still black"}, format="json")
    assert reply.json() == {"ok": True, "outcome": "comment"}
    assert mine.get("/api/v1/portal").json()["comments"][-1]["mine"] is True
    # Replies only work on your own tickets; the database refuses the rest.
    assert (
        someone.post(f"/api/v1/portal/incidents/{incident_id}/replies", {"body": "hi"}, format="json").status_code
        == 400
    )


def test_portal_requires_a_confirmed_domain_account(portal_org, make_user, opa):
    outsider = make_user(portal_org, email="person@gmail.com")
    assert outsider.get("/api/v1/portal").status_code == 403
    assert submit(outsider).status_code == 403


def test_public_knowledge_is_published_only_and_needs_no_sign_in(portal_org):
    published = str(
        seed(
            "INSERT INTO public.knowledge_articles(organization_id, number, title, summary, content, category, status, "
            "published_at) VALUES (%s, 'KB777001', 'Reset your password', 'Self-service reset', 'Go to the portal', "
            "'access', 'published', now()) RETURNING id",
            [portal_org],
        )[0]
    )
    draft = str(
        seed(
            "INSERT INTO public.knowledge_articles(organization_id, number, title, category, status) "
            "VALUES (%s, 'KB777002', 'Draft password notes', 'access', 'draft') RETURNING id",
            [portal_org],
        )[0]
    )
    anonymous = Client()
    listing = anonymous.get("/api/public/knowledge", {"query": "password"}).json()
    assert [a["number"] for a in listing["articles"]] == ["KB777001"]
    assert anonymous.get(f"/api/public/knowledge/{published}").json()["content"] == "Go to the portal"
    assert anonymous.get(f"/api/public/knowledge/{draft}").status_code == 404


def test_integration_status_reports_configuration_without_secret_values(org, make_user, opa, settings, monkeypatch):
    settings.MONITORING_WEBHOOK_TOKEN = "monitoring-secret-value-0123456789abcdef"
    settings.PAGERDUTY_WEBHOOK_SECRET = "pagerduty-secret-value"
    settings.SECURITY_SCANNER_SECRET = ""
    settings.SLACK_WEBHOOK_URL = "https://hooks.slack.example/T000/B000/slack-secret-path"
    settings.ANTHROPIC_API_KEY = "sk-ant-secret-value"
    monkeypatch.setattr(
        probes, "read_tools", lambda: [{"name": "Grafana", "kind": "Dashboards", "url": "", "state": "up"}]
    )
    admin = make_user(org, roles=("requester", "admin"))
    manager = make_user(org, roles=("requester", "manager"))

    response = admin.get(f"/api/v1/orgs/{org}/integrations/status?force=1")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["channels"] == {
        "monitoring": True,
        "pagerduty": True,
        "scanner": False,
        "slack": True,
        "teams": False,
        "assistant": True,
    }
    assert body["endpoints"]["pagerduty"].endswith("/api/public/pagerduty")
    assert {"Database", "Grafana"} <= {t["name"] for t in body["tools"]}
    raw = response.content.decode()
    for secret in ("monitoring-secret-value", "pagerduty-secret-value", "slack-secret-path", "sk-ant-secret"):
        assert secret not in raw
    assert manager.get(f"/api/v1/orgs/{org}/integrations/status").status_code == 403
