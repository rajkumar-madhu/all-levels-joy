import logging

import requests
from celery import shared_task
from django.conf import settings
from django.db import transaction

from apps.core.db import act_as_service, call_function

log = logging.getLogger(__name__)


@shared_task
def expire_security_exceptions() -> int:
    """Replaces the external cron that called /api/public/security-exceptions-expire."""
    with transaction.atomic():
        act_as_service()
        expired = call_function("itsm_expire_security_exceptions")
    log.info("expired %s security exceptions", expired)
    return expired


@shared_task(autoretry_for=(requests.RequestException,), retry_backoff=True, max_retries=3)
def post_chat_notification(text: str) -> None:
    for url in filter(None, [settings.SLACK_WEBHOOK_URL, settings.TEAMS_WEBHOOK_URL]):
        requests.post(url, json={"text": text}, timeout=5).raise_for_status()
