"""Ask the OPA sidecar for authorization decisions (package itsm.authz)."""

import logging

import requests
from django.conf import settings

from .principal import Principal

log = logging.getLogger(__name__)


class PolicyUnavailable(Exception):
    pass


def build_input(principal: Principal, action: str, resource: dict) -> dict:
    return {
        "subject": {
            "id": principal.user_id,
            "email": principal.email,
            "email_verified": principal.email_verified,
            "roles": principal.roles_by_workspace(),
        },
        "action": action,
        "resource": resource,
    }


def evaluate(principal: Principal, action: str, resource: dict) -> bool:
    url = f"{settings.OPA_URL.rstrip('/')}/{settings.OPA_DECISION_PATH.lstrip('/')}"
    try:
        response = requests.post(
            url,
            json={"input": build_input(principal, action, resource)},
            timeout=settings.OPA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json().get("result") is True
    except (requests.RequestException, ValueError) as error:
        log.error("OPA decision failed for %s: %s", action, error)
        raise PolicyUnavailable from error
