"""Integrations status for administrators (legacy /integrations).

Reports whether each intake channel is configured as a boolean only: secret values never leave settings.
"""

from django.conf import settings
from django.db import connection
from rest_framework.response import Response

from apps.core.views import CallerAPIView

from . import probes


def database_state() -> str:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return "up"
    except Exception:  # noqa: BLE001
        return "down"


class IntegrationStatusView(CallerAPIView):
    policy_actions = {"GET": "integrations.read"}

    def get(self, request, org_id):
        checked_at, tools = probes.cached_tools(force=request.query_params.get("force") in ("1", "true"))
        endpoint = request.build_absolute_uri
        expiry_minutes = settings.CELERY_BEAT_SCHEDULE["expire-security-exceptions"]["schedule"] // 60
        return Response(
            {
                "checkedAt": checked_at,
                "channels": {
                    "monitoring": bool(settings.MONITORING_WEBHOOK_TOKEN),
                    "pagerduty": bool(settings.PAGERDUTY_WEBHOOK_SECRET),
                    "scanner": bool(settings.SECURITY_SCANNER_SECRET),
                    "slack": bool(settings.SLACK_WEBHOOK_URL),
                    "teams": bool(settings.TEAMS_WEBHOOK_URL),
                    "assistant": bool(getattr(settings, "ANTHROPIC_API_KEY", None)),
                },
                "endpoints": {
                    "alerts": endpoint("/api/public/alerts"),
                    "pagerduty": endpoint("/api/public/pagerduty"),
                    "scanner": endpoint("/api/public/security-findings"),
                },
                # Celery beat replaced the legacy external cron; it needs the Redis broker.
                "scheduledJobs": [
                    {
                        "name": "Expire security exceptions",
                        "schedule": f"Every {expiry_minutes} minutes",
                    }
                ],
                "tools": [{"name": "Database", "kind": "Data", "url": "", "state": database_state()}, *tools],
            }
        )
