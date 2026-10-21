import hashlib
import hmac
import json
import uuid

import pytest
from django.test import Client

from apps.integrations import alerts

from .conftest import SEEDED_ORG, seed

TOKEN = "t" * 40
SECRET = "scanner-secret"
PD_SECRET = "pagerduty-secret"


@pytest.fixture(autouse=True)
def secrets(settings):
    settings.MONITORING_WEBHOOK_TOKEN = TOKEN
    settings.SECURITY_SCANNER_SECRET = SECRET
    settings.PAGERDUTY_WEBHOOK_SECRET = PD_SECRET
    settings.INTEGRATION_ORG_ID = SEEDED_ORG
    settings.CELERY_TASK_ALWAYS_EAGER = True


# --- Pure parsing (no database) -------------------------------------------------------------------


def test_alertmanager_payload_is_normalised():
    [alert] = alerts.parse_alert_payload(
        {
            "alerts": [
                {
                    "status": "firing",
                    "labels": {
                        "alertname": "HighCPU",
                        "instance": "db-01:9100",
                        "job": "node",
                        "severity": "CRITICAL",
                    },
                    "annotations": {"summary": "CPU above 95%"},
                    "generatorURL": "javascript:alert(1)",
                }
            ]
        }
    )
    assert alert.source == "prometheus"
    assert alert.fingerprint == "highcpu-db-01-9100-node"
    assert alert.severity == "critical"
    assert alert.link is None
    assert alerts.alert_marker(alert) == "[alert:prometheus:highcpu-db-01-9100-node]"
    assert alerts.severity_to_impact(alert.severity) == (1, 1)


def test_grafana_and_generic_payloads():
    [g] = alerts.parse_alert_payload({"orgId": 1, "alerts": [{"status": "resolved", "labels": {}}]})
    assert (g.source, g.name) == ("grafana", "Unnamed alert")
    [w] = alerts.parse_alert_payload({"name": "Disk full", "instance": "bad host!"})
    assert (w.source, w.status, w.instance, w.fingerprint) == (
        "webhook",
        "firing",
        None,
        "disk-full-bad-host",
    )
    assert alerts.parse_alert_payload({"alerts": []}) is None
    assert alerts.parse_alert_payload(["not", "an", "object"]) is None


# --- Endpoints ------------------------------------------------------------------------------------


def post_alert(payload, token=TOKEN):
    return Client().post(
        "/api/public/alerts",
        json.dumps(payload),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )


@pytest.mark.django_db(transaction=True)
def test_alert_token_is_required():
    assert post_alert({"name": "x"}, token="wrong").status_code == 401


@pytest.mark.django_db(transaction=True)
def test_alert_creates_one_monitoring_incident_and_dedupes():
    name = f"Queue backlog {uuid.uuid4().hex[:6]}"
    first = post_alert({"name": name, "severity": "warning", "summary": "Backlog above 10k"}).json()
    assert first["results"][0]["action"] == "created"
    number = first["results"][0]["number"]
    again = post_alert({"name": name, "severity": "warning"}).json()
    assert again["results"][0] == {
        "alert": name,
        "status": "firing",
        "number": number,
        "action": "deduplicated",
    }
    cleared = post_alert({"name": name, "status": "resolved"}).json()
    assert cleared["results"][0]["action"] == "noted"
    description = seed("SELECT description FROM public.incidents WHERE number = %s", [number])[0]
    assert "[alert:webhook:" in description and "Alert cleared by Generic webhook" in description


def pd_event(event_id, incident_id, event_type="incident.triggered", status="triggered"):
    return {
        "event": {
            "id": event_id,
            "event_type": event_type,
            "occurred_at": "2026-10-21T09:00:00Z",
            "data": {
                "id": incident_id,
                "type": "incident",
                "status": status,
                "title": "Checkout 5xx",
                "urgency": "high",
                "html_url": "https://acme.pagerduty.com/incidents/" + incident_id,
                "service": {"summary": "checkout"},
            },
        }
    }


def post_pd(payload, secret=PD_SECRET):
    body = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return Client().post(
        "/api/public/pagerduty",
        body,
        content_type="application/json",
        HTTP_X_PAGERDUTY_SIGNATURE=f"v1=deadbeef,v1={sig}",
    )


@pytest.mark.django_db(transaction=True)
def test_pagerduty_signature_and_upsert():
    incident = f"P{uuid.uuid4().hex[:8].upper()}"
    assert post_pd(pd_event("e1", incident), secret="wrong").status_code == 401
    first = post_pd(pd_event(f"ev-{incident}-1", incident))
    assert first.status_code == 200, first.content
    ack = post_pd(pd_event(f"ev-{incident}-2", incident, "incident.acknowledged", "acknowledged"))
    assert ack.status_code == 200, ack.content
    linked = seed("SELECT count(*) FROM public.pagerduty_incidents WHERE pagerduty_id = %s", [incident])
    assert linked[0] == 1
    mismatch = post_pd(pd_event("ev-x", incident, "incident.resolved", "triggered"))
    assert mismatch.status_code == 400


def post_scanner(payload, secret=SECRET):
    body = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return Client().post(
        "/api/public/security-findings",
        body,
        content_type="application/json",
        HTTP_X_ARGUS_SIGNATURE=f"sha256={sig}",
    )


@pytest.mark.django_db(transaction=True)
def test_scanner_findings_are_signed_and_deduplicated():
    finding = {
        "scanner": "trivy",
        "reference": f"CVE-2026-{uuid.uuid4().hex[:5]}",
        "title": "openssl vulnerable",
        "severity": "high",
    }
    assert post_scanner({"findings": [finding]}, secret="nope").status_code == 401
    first = post_scanner({"findings": [finding]})
    assert first.status_code == 200, first.content
    assert first.json()["results"][0]["created"] is True
    second = post_scanner({"findings": [finding]})
    assert second.json()["results"][0]["created"] is False
    assert second.json()["results"][0]["number"] == first.json()["results"][0]["number"]
    assert post_scanner({"findings": [{**finding, "severity": "urgent"}]}).status_code == 400


@pytest.mark.django_db(transaction=True)
def test_expire_security_exceptions_task_runs_as_service_role():
    from apps.integrations.tasks import expire_security_exceptions

    assert expire_security_exceptions() >= 0
