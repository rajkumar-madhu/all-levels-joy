"""Sending a test message through a configured channel (Integrations page "Test connection")."""

import pytest
import requests
from django.core import mail

from apps.integration_status import views

pytestmark = pytest.mark.django_db(transaction=True)


def url(org):
    return f"/api/v1/orgs/{org}/integrations/test"


class Reply:
    def __init__(self, status):
        self.status_code = status


def fake_http(monkeypatch, post):
    """Replace only this view's HTTP client; the API keeps calling OPA for real."""

    class Fake:
        RequestException = requests.RequestException

    Fake.post = staticmethod(post)
    monkeypatch.setattr(views, "requests", Fake)


def test_slack_test_posts_and_hides_the_webhook(org, make_user, opa, settings, monkeypatch):
    settings.SLACK_WEBHOOK_URL = "https://hooks.slack.example/T0/B0/secret-path"
    sent = []
    fake_http(monkeypatch, lambda u, json, timeout: sent.append((u, json)) or Reply(200))
    admin = make_user(org, roles=("requester", "admin"))
    ok = admin.post(url(org), {"channel": "slack"}, format="json").json()
    assert ok == {"ok": True, "message": "Test message posted to Slack."}
    assert sent[0][0] == settings.SLACK_WEBHOOK_URL and "Test message from Argus" in sent[0][1]["text"]

    fake_http(monkeypatch, lambda u, json, timeout: Reply(404))
    refused = admin.post(url(org), {"channel": "slack"}, format="json")
    assert refused.json() == {"ok": False, "error": "Slack refused the message (HTTP 404)."}

    def down(u, json, timeout):
        raise requests.ConnectionError("boom https://hooks.slack.example/T0/B0/secret-path")

    fake_http(monkeypatch, down)
    unreachable = admin.post(url(org), {"channel": "slack"}, format="json")
    assert unreachable.json()["ok"] is False and "secret-path" not in unreachable.content.decode()


def test_email_test_goes_to_the_admin(org, make_user, opa, settings):
    settings.EMAIL_HOST = "smtp.example.test"
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    admin = make_user(org, roles=("requester", "admin"), email="ops.admin@wecrew.in")
    ok = admin.post(url(org), {"channel": "email"}, format="json").json()
    assert ok["ok"] is True and ok["message"] == "Test email sent to ops.admin@wecrew.in."
    assert [m.to for m in mail.outbox] == [["ops.admin@wecrew.in"]]


def test_unconfigured_channels_and_non_admins_are_refused(org, make_user, opa, settings):
    settings.TEAMS_WEBHOOK_URL = None
    settings.EMAIL_HOST = None
    admin = make_user(org, roles=("requester", "admin"))
    teams = admin.post(url(org), {"channel": "teams"}, format="json")
    assert teams.status_code == 400 and "TEAMS_WEBHOOK_URL" in teams.json()["detail"]
    assert admin.post(url(org), {"channel": "email"}, format="json").status_code == 400
    assert admin.post(url(org), {"channel": "fax"}, format="json").status_code == 400
    manager = make_user(org, roles=("requester", "manager"))
    assert manager.post(url(org), {"channel": "slack"}, format="json").status_code == 403
