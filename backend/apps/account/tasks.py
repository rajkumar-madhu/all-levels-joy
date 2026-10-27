"""Email digests of in-app notifications.

Every few minutes, each person with new unread notifications gets one email listing them, if their profile's
"email digest" preference is on (the default) and their address is confirmed. A notification already read in
the app, older than the delivery window, or for someone who opted out is marked skipped and never sent.
"""

import logging
from datetime import timedelta
from html import escape
from itertools import groupby

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import transaction

from apps.core.db import act_as_service, execute, fetch_all

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
DELIVERY_WINDOW = timedelta(days=2)
BATCH = 500
# Where each record type opens in the app (record_id is filled in where the page takes one).
RECORD_PATHS = {
    "incident": "/incidents/{id}",
    "service_request": "/requests/{id}",
    "change": "/changes/{id}",
    "problem": "/problems/{id}",
    "major_incident": "/command-center",
    "approval": "/approvals",
    "security_finding": "/security",
}


def record_link(record_type: str | None, record_id) -> str:
    path = RECORD_PATHS.get(record_type or "", "/")
    return settings.APP_PUBLIC_URL.rstrip("/") + path.format(id=record_id)


def build_message(email: str, items: list[dict]) -> EmailMultiAlternatives:
    subject = f"[Argus] {items[0]['title']}" if len(items) == 1 else f"[Argus] {len(items)} new notifications"
    profile = settings.APP_PUBLIC_URL.rstrip("/") + "/profile"
    lines, blocks = [], []
    for n in items:
        link = record_link(n["record_type"], n["record_id"])
        lines += [f"- {n['title']} ({n['workspace']})", *([f"  {n['body']}"] if n["body"] else []), f"  {link}", ""]
        blocks.append(
            f'<li style="margin-bottom:12px"><a href="{escape(link)}"><strong>{escape(n["title"])}</strong></a>'
            f' <span style="color:#64748b">· {escape(n["workspace"])}</span>'
            + (f'<br><span style="color:#334155">{escape(n["body"])}</span>' if n["body"] else "")
            + "</li>"
        )
    footer = f"You get these because email notifications are on in your profile: {profile}"
    message = EmailMultiAlternatives(
        subject=subject,
        body="\n".join([*lines, footer]),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[email],
    )
    message.attach_alternative(
        f'<div style="font-family:sans-serif;font-size:14px"><ul style="padding-left:18px">{"".join(blocks)}</ul>'
        f'<p style="color:#64748b;font-size:12px">You get these because email notifications are on in your '
        f'<a href="{escape(profile)}">profile</a>.</p></div>',
        "text/html",
    )
    return message


def mark(ids: list, status: str | None, attempts_only: bool = False) -> None:
    if attempts_only:
        execute(
            "UPDATE public.notifications SET email_attempts = email_attempts + 1, "
            "email_status = CASE WHEN email_attempts + 1 >= %s THEN 'failed' END WHERE id = ANY(%s::uuid[])",
            [MAX_ATTEMPTS, [str(i) for i in ids]],
        )
    else:
        execute(
            "UPDATE public.notifications SET email_status = %s, emailed_at = CASE WHEN %s = 'sent' THEN now() END "
            "WHERE id = ANY(%s::uuid[])",
            [status, status, [str(i) for i in ids]],
        )


@shared_task
def send_notification_digests() -> int:
    """Send pending notifications as one email per person. Returns the number of emails sent."""
    if not settings.EMAIL_HOST:
        return 0
    sent = 0
    with transaction.atomic():
        act_as_service()
        rows = fetch_all(
            "SELECT n.id, n.user_id, n.title, n.body, n.record_type, n.record_id, n.created_at, n.read_at, "
            "o.name AS workspace, u.email, u.email_confirmed_at IS NOT NULL AS confirmed, "
            "coalesce((p.preferences->>'emailDigest')::boolean, true) AS wants_email, "
            "n.created_at < now() - %s AS too_old "
            "FROM public.notifications n "
            "JOIN public.organizations o ON o.id = n.organization_id "
            "JOIN auth.users u ON u.id = n.user_id "
            "LEFT JOIN public.profiles p ON p.id = n.user_id "
            "WHERE n.email_status IS NULL ORDER BY n.user_id, n.created_at LIMIT %s FOR UPDATE OF n SKIP LOCKED",
            [DELIVERY_WINDOW, BATCH],
        )
        with get_connection() as connection:
            for _, group in groupby(rows, key=lambda r: r["user_id"]):
                group = list(group)
                skip = [r["id"] for r in group if r["read_at"] or r["too_old"]]
                due = [r for r in group if not (r["read_at"] or r["too_old"])]
                if due and not (due[0]["email"] and due[0]["confirmed"] and due[0]["wants_email"]):
                    skip += [r["id"] for r in due]
                    due = []
                if skip:
                    mark(skip, "skipped")
                if not due:
                    continue
                try:
                    message = build_message(due[0]["email"], due)
                    message.connection = connection
                    message.send()
                except Exception as error:  # noqa: BLE001 - any transport failure is retried, then marked failed
                    log.warning("notification email to user %s failed: %s", due[0]["user_id"], error)
                    mark([r["id"] for r in due], None, attempts_only=True)
                    continue
                mark([r["id"] for r in due], "sent")
                sent += 1
    log.info("sent %s notification digest emails", sent)
    return sent
