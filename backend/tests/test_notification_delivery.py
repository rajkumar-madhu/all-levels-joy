"""Email digests of notifications and chat posts for major incident declarations."""

import pytest
from django.core import mail

from apps.account import tasks
from apps.integrations import tasks as chat_tasks

from .conftest import seed
from .test_major_incidents import declare, raise_incident

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def smtp(settings):
    settings.EMAIL_HOST = "smtp.example.test"
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.APP_PUBLIC_URL = "https://itsm.example.test"
    settings.DEFAULT_FROM_EMAIL = "Argus <no-reply@example.test>"
    # Other tests leave notifications behind; each test here starts with none pending.
    seed("UPDATE public.notifications SET email_status = 'skipped' WHERE email_status IS NULL")


def notify(org, user_id, title, record_type="incident", body="Details <here>"):
    return str(
        seed(
            "INSERT INTO public.notifications(organization_id, user_id, title, body, record_type, record_id) "
            "VALUES (%s, %s, %s, %s, %s, gen_random_uuid()) RETURNING id",
            [org, user_id, title, body, record_type],
        )[0]
    )


def status(notification_id):
    return seed("SELECT email_status FROM public.notifications WHERE id = %s", [notification_id])[0]


def test_one_digest_per_person_with_links_and_escaping(org, make_user, smtp):
    alice = make_user(org, roles=("requester", "manager"))
    bob = make_user(org, roles=("requester", "service_desk"))
    first = notify(org, alice.user_id, "INC0001 assigned to you")
    second = notify(org, alice.user_id, "MI0001 declared — severity 1", record_type="major_incident")
    third = notify(org, bob.user_id, "Approval needed", record_type="approval")

    assert tasks.send_notification_digests() == 2
    by_subject = {m.subject: m for m in mail.outbox}
    digest = by_subject["[Argus] 2 new notifications"]
    assert digest.from_email == "Argus <no-reply@example.test>"
    assert "INC0001 assigned to you" in digest.body and "https://itsm.example.test/command-center" in digest.body
    html = digest.alternatives[0][0]
    assert "Details &lt;here&gt;" in html and "<here>" not in html
    assert "[Argus] Approval needed" in by_subject
    assert [status(n) for n in (first, second, third)] == ["sent", "sent", "sent"]
    # Nothing is sent twice.
    assert tasks.send_notification_digests() == 0 and len(mail.outbox) == 2


def test_opted_out_read_and_old_notifications_are_skipped(org, make_user, smtp):
    opted_out = make_user(org, roles=("requester", "manager"))
    seed(
        "UPDATE public.profiles SET preferences = '{\"emailDigest\": false}'::jsonb WHERE id = %s",
        [opted_out.user_id],
    )
    reader = make_user(org, roles=("requester", "manager"))
    a = notify(org, opted_out.user_id, "Quiet please")
    b = notify(org, reader.user_id, "Already seen")
    seed("UPDATE public.notifications SET read_at = now() WHERE id = %s", [b])
    c = notify(org, reader.user_id, "Too old")
    seed("UPDATE public.notifications SET created_at = now() - interval '3 days' WHERE id = %s", [c])

    assert tasks.send_notification_digests() == 0
    assert mail.outbox == []
    assert [status(n) for n in (a, b, c)] == ["skipped", "skipped", "skipped"]


def test_failed_sends_retry_then_give_up(org, make_user, smtp, monkeypatch):
    person = make_user(org, roles=("requester", "manager"))
    n = notify(org, person.user_id, "Will not send")

    def broken(self, *args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(tasks.EmailMultiAlternatives, "send", broken)
    for _ in range(tasks.MAX_ATTEMPTS - 1):
        tasks.send_notification_digests()
        assert status(n) is None
    tasks.send_notification_digests()
    assert status(n) == "failed"


def test_without_smtp_nothing_is_sent_or_marked(org, make_user, settings):
    settings.EMAIL_HOST = None
    person = make_user(org, roles=("requester", "manager"))
    n = notify(org, person.user_id, "Waiting for SMTP")
    assert tasks.send_notification_digests() == 0
    assert status(n) is None


def test_declaration_is_posted_to_chat(org, make_user, opa, settings, monkeypatch):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.SLACK_WEBHOOK_URL = "https://hooks.slack.example/T0/B0/x"
    settings.TEAMS_WEBHOOK_URL = None
    settings.APP_PUBLIC_URL = "https://itsm.example.test"
    posted = []

    class Ok:
        def raise_for_status(self):
            return None

    class FakeRequests:
        RequestException = chat_tasks.requests.RequestException

        @staticmethod
        def post(url, json, timeout):
            posted.append((url, json))
            return Ok()

    # Only the chat task's HTTP client is replaced; the API still calls OPA for real.
    monkeypatch.setattr(chat_tasks, "requests", FakeRequests)
    agent = make_user(org, roles=("requester", "service_desk"))
    declared = declare(agent, org, raise_incident(agent, org))
    assert declared.status_code == 201, declared.content
    [(url, payload)] = posted
    assert url == settings.SLACK_WEBHOOK_URL
    assert payload["text"].startswith(f"🚨 {declared.json()['number']} declared — severity 1:")
    assert payload["text"].endswith("https://itsm.example.test/command-center")
