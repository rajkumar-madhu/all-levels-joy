import logging

from celery import shared_task
from django.db import transaction

from apps.core.db import act_as_service, fetch_all, fetch_one

from . import vault

log = logging.getLogger(__name__)


@shared_task
def rotate_secret(secret_id: str, actor_id: str | None = None, trigger: str = "checkin") -> dict:
    with transaction.atomic():
        act_as_service()
        return vault.rotate(secret_id, actor_id, trigger)


@shared_task
def expire_access() -> int:
    """Close approved requests whose window has ended, and rotate passwords that were revealed in them
    when the secret asks for rotation after use."""
    with transaction.atomic():
        act_as_service()
        rows = fetch_all(
            "UPDATE public.pam_access_requests r SET status = 'expired' FROM public.pam_secrets s "
            "WHERE s.id = r.secret_id AND r.status = 'approved' AND r.expires_at <= now() "
            "RETURNING r.id, r.organization_id, r.secret_id, r.requester_id, r.reveal_count, s.name, "
            "s.rotate_after_checkout"
        )
        for row in rows:
            vault.log_event(
                row["organization_id"],
                "access_expired",
                secret_id=row["secret_id"],
                secret_name=row["name"],
                request_id=row["id"],
                actor_id=row["requester_id"],
            )
    for secret_id in {r["secret_id"] for r in rows if r["rotate_after_checkout"] and r["reveal_count"]}:
        rotate_secret(str(secret_id), None, "expiry")
    log.info("expired %s privileged access requests", len(rows))
    return len(rows)


@shared_task
def rotate_due() -> int:
    with transaction.atomic():
        act_as_service()
        due = fetch_all(
            "SELECT id FROM public.pam_secrets WHERE rotation_enabled AND next_rotation_at <= now() "
            "ORDER BY next_rotation_at LIMIT 200"
        )
    rotated = 0
    for row in due:
        with transaction.atomic():
            act_as_service()
            # Another worker may have rotated it meanwhile; skip rows it still holds.
            if not fetch_one(
                "SELECT id FROM public.pam_secrets WHERE id = %s AND rotation_enabled AND next_rotation_at <= now() "
                "FOR UPDATE SKIP LOCKED",
                [str(row["id"])],
            ):
                continue
            rotated += vault.rotate(row["id"], None, "schedule")["ok"]
    log.info("rotated %s of %s due privileged secrets", rotated, len(due))
    return rotated


@shared_task
def verify_enabled() -> int:
    with transaction.atomic():
        act_as_service()
        ids = [r["id"] for r in fetch_all("SELECT id FROM public.pam_secrets WHERE verify_enabled LIMIT 1000")]
    failed = 0
    for secret_id in ids:
        with transaction.atomic():
            act_as_service()
            failed += not vault.verify(secret_id, None)["ok"]
    log.info("verified %s privileged secrets, %s failed", len(ids), failed)
    return failed
