"""Integrations status for administrators (legacy /integrations).

Reports whether each intake channel is configured as a boolean only: secret values never leave settings.
"""

import requests
from django.conf import settings
from django.core.mail import send_mail
from django.db import connection
from rest_framework import serializers
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
        digest_minutes = settings.CELERY_BEAT_SCHEDULE["notification-email-digests"]["schedule"] // 60
        return Response(
            {
                "checkedAt": checked_at,
                "channels": {
                    "monitoring": bool(settings.MONITORING_WEBHOOK_TOKEN),
                    "pagerduty": bool(settings.PAGERDUTY_WEBHOOK_SECRET),
                    "scanner": bool(settings.SECURITY_SCANNER_SECRET),
                    "slack": bool(settings.SLACK_WEBHOOK_URL),
                    "teams": bool(settings.TEAMS_WEBHOOK_URL),
                    "email": bool(settings.EMAIL_HOST),
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
                    },
                    {
                        "name": "Email notification digests",
                        "schedule": f"Every {digest_minutes} minutes",
                    },
                ],
                "tools": [{"name": "Database", "kind": "Data", "url": "", "state": database_state()}, *tools],
            }
        )


CHAT_CHANNELS = {"slack": ("Slack", "SLACK_WEBHOOK_URL"), "teams": ("Microsoft Teams", "TEAMS_WEBHOOK_URL")}


class TestSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=["slack", "teams", "email"])


class IntegrationTestView(CallerAPIView):
    """Send one test message through a configured channel so an administrator can see it arrive.

    Errors say what failed without echoing webhook URLs or credentials.
    """

    policy_actions = {"POST": "integrations.test"}

    def post(self, request, org_id):
        data = TestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        channel = data.validated_data["channel"]
        sender = request.user.email or "an administrator"
        if channel == "email":
            if not settings.EMAIL_HOST:
                return Response({"detail": "Email isn't set up. Set EMAIL_HOST on the API first."}, status=400)
            if not request.user.email:
                return Response({"detail": "Your account has no email address to send the test to."}, status=400)
            try:
                send_mail(
                    "[Argus] Test email",
                    "This is a test email from Argus Service Desk. Notification digests will arrive like this.",
                    settings.DEFAULT_FROM_EMAIL,
                    [request.user.email],
                )
            except Exception as error:  # noqa: BLE001 - report any transport failure to the admin
                return Response({"ok": False, "error": f"The mail server did not accept the message: {error}"})
            return Response({"ok": True, "message": f"Test email sent to {request.user.email}."})

        name, setting = CHAT_CHANNELS[channel]
        url = getattr(settings, setting)
        if not url:
            return Response({"detail": f"{name} isn't set up. Set {setting} on the API first."}, status=400)
        try:
            reply = requests.post(
                url, json={"text": f"✅ Test message from Argus Service Desk, sent by {sender}."}, timeout=5
            )
        except requests.RequestException:
            return Response(
                {"ok": False, "error": f"Could not reach {name}. Check the webhook URL and network access."}
            )
        if reply.status_code >= 400:
            return Response({"ok": False, "error": f"{name} refused the message (HTTP {reply.status_code})."})
        return Response({"ok": True, "message": f"Test message posted to {name}."})
