"""Public intake endpoints. Callers bypass site sign-in, so each request is authenticated with its own
shared secret before anything is parsed, and work runs as the service role."""

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.db import DatabaseError, transaction
from django.http import HttpResponse, JsonResponse
from django.views import View

from apps.core.db import act_as_service, call_function, fetch_one, jsonb
from apps.security.serializers import ScannerFindingSerializer, ScannerPayloadSerializer

from . import alerts as alert_rules
from .signatures import bearer_token_valid, pagerduty_signature_valid, scanner_signature_valid
from .tasks import post_chat_notification

log = logging.getLogger(__name__)
MAX_BODY_BYTES = 512_000
NO_STORE = {"Cache-Control": "no-store"}


def read_body(request) -> bytes | HttpResponse:
    try:
        if int(request.META.get("CONTENT_LENGTH") or 0) > MAX_BODY_BYTES:
            return HttpResponse("Payload too large", status=413)
        body = request.body
    except (RequestDataTooBig, ValueError):
        return HttpResponse("Payload too large", status=413)
    if len(body) > MAX_BODY_BYTES:
        return HttpResponse("Payload too large", status=413)
    return body


def parse_json(body: bytes):
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


class AlertsView(View):
    """Prometheus Alertmanager / Grafana / generic webhooks. Auth: `Authorization: Bearer <token>`."""

    http_method_names = ["post"]

    def post(self, request):
        secret = settings.MONITORING_WEBHOOK_TOKEN
        if (
            not secret
            or len(secret) < alert_rules.MIN_TOKEN_LENGTH
            or not bearer_token_valid(request.headers.get("Authorization", ""), secret)
        ):
            return HttpResponse("Unauthorized", status=401)
        body = read_body(request)
        if isinstance(body, HttpResponse):
            return body
        payload = parse_json(body)
        if payload is None:
            return HttpResponse("Invalid JSON", status=400)
        parsed = alert_rules.parse_alert_payload(payload)
        if not parsed:
            return JsonResponse({"error": "Unrecognised alert payload"}, status=400)

        act_as_service()
        org_id = settings.INTEGRATION_ORG_ID
        results = []
        for alert in parsed:
            marker = alert_rules.alert_marker(alert)
            existing = fetch_one(
                "SELECT id, number, description FROM public.incidents WHERE organization_id = %s "
                "AND contact_type = 'monitoring' AND state NOT IN ('resolved', 'closed', 'cancelled') "
                "AND strpos(description, %s) > 0 LIMIT 1",
                [org_id, marker],
            )
            if alert.status == "resolved":
                if existing:
                    label = alert_rules.SOURCE_LABELS[alert.source]
                    fetch_one(
                        "UPDATE public.incidents SET description = %s WHERE id = %s RETURNING id",
                        [
                            f"{existing['description']}\n\nAlert cleared by {label} at "
                            f"{datetime.now(UTC).isoformat()}.",
                            existing["id"],
                        ],
                    )
                    results.append(
                        {
                            "alert": alert.name,
                            "status": "resolved",
                            "number": existing["number"],
                            "action": "noted",
                        }
                    )
                else:
                    results.append({"alert": alert.name, "status": "resolved", "action": "ignored"})
                continue
            if existing:
                results.append(
                    {
                        "alert": alert.name,
                        "status": "firing",
                        "number": existing["number"],
                        "action": "deduplicated",
                    }
                )
                continue

            recent = fetch_one(
                "SELECT count(*) AS n FROM public.incidents WHERE organization_id = %s "
                "AND contact_type = 'monitoring' AND created_at >= now() - make_interval(secs => %s)",
                [org_id, alert_rules.RATE_WINDOW_SECONDS],
            )
            if recent["n"] >= alert_rules.MAX_NEW_INCIDENTS_PER_WINDOW:
                return JsonResponse(
                    {"error": "Too many requests", "results": results},
                    status=429,
                    headers={"Retry-After": "600"},
                )
            created = self._create_incident(org_id, alert, marker)
            results.append(created)
        return JsonResponse({"results": results}, headers=NO_STORE)

    def _create_incident(self, org_id: str, alert, marker: str) -> dict:
        service_id = None
        if alert.instance:
            host = alert.instance.split(":")[0]
            ci = fetch_one(
                "SELECT service_id FROM public.configuration_items WHERE organization_id = %s "
                "AND (name = %s OR host(ip_address) = %s) ORDER BY (name = %s) DESC LIMIT 1",
                [org_id, host, host, host],
            )
            service_id = ci["service_id"] if ci else None
        impact, urgency = alert_rules.severity_to_impact(alert.severity)
        hours = 2 if impact + urgency <= 2 else 8 if impact + urgency <= 4 else 24
        description = "\n".join(
            line
            for line in [
                alert.summary or "Raised automatically from monitoring.",
                f"Source: {alert_rules.SOURCE_LABELS[alert.source]}",
                f"Severity: {alert.severity}",
                f"Instance: {alert.instance}" if alert.instance else None,
                f"Service/job: {alert.service}" if alert.service else None,
                f"Link: {alert.link}" if alert.link else None,
                marker,
            ]
            if line
        )
        title = f"[{alert.severity.upper()}] {alert.name}{f' — {alert.instance}' if alert.instance else ''}"[:200]
        try:
            with transaction.atomic():
                counter = fetch_one(
                    "UPDATE public.record_counters SET current_value = current_value + 1, updated_at = now() "
                    "WHERE organization_id = %s AND prefix = 'INC' RETURNING current_value",
                    [org_id],
                )
                if not counter:
                    raise DatabaseError("INC counter missing")
                number = "INC" + str(counter["current_value"]).zfill(7)
                fetch_one(
                    "INSERT INTO public.incidents(organization_id, number, title, description, category, "
                    "contact_type, impact, urgency, service_id, sla_due_at) "
                    "VALUES (%s, %s, %s, %s, 'network', 'monitoring', %s, %s, %s, %s) RETURNING id",
                    [
                        org_id,
                        number,
                        title,
                        description,
                        impact,
                        urgency,
                        service_id,
                        datetime.now(UTC) + timedelta(hours=hours),
                    ],
                )
        except DatabaseError as error:
            log.error("alert incident failed: %s", error)
            return {"alert": alert.name, "status": "firing", "action": "failed"}
        if impact == 1:
            text = (
                f"🚨 {number} — {alert.name} ({alert.severity}) from {alert_rules.SOURCE_LABELS[alert.source]}"
                f"{f' on {alert.instance}' if alert.instance else ''}. {settings.APP_PUBLIC_URL}/incidents"
            )
            transaction.on_commit(lambda: post_chat_notification.delay(text))
        return {"alert": alert.name, "status": "firing", "number": number, "action": "created"}


PAGERDUTY_EVENTS = ["incident.triggered", "incident.acknowledged", "incident.resolved", "incident.reopened"]
OFFSET_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$", re.IGNORECASE)


def _bad(message: str) -> JsonResponse:
    return JsonResponse({"error": message}, status=400)


class PagerDutyView(View):
    """PagerDuty webhook v3, signed with X-PagerDuty-Signature (HMAC-SHA256)."""

    http_method_names = ["get", "post"]

    def get(self, request):
        return JsonResponse({"ok": bool(settings.PAGERDUTY_WEBHOOK_SECRET), "events": PAGERDUTY_EVENTS})

    def post(self, request):
        secret = settings.PAGERDUTY_WEBHOOK_SECRET
        if not secret:
            return HttpResponse("PagerDuty intake is not configured", status=503)
        body = read_body(request)
        if isinstance(body, HttpResponse):
            return body
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            return HttpResponse("Invalid UTF-8 body", status=400)
        if not pagerduty_signature_valid(body, request.headers.get("X-PagerDuty-Signature", ""), secret):
            return HttpResponse("Invalid signature", status=401)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return HttpResponse("Invalid JSON", status=400)
        event = payload.get("event") if isinstance(payload, dict) else None
        if not isinstance(event, dict):
            return HttpResponse("Invalid PagerDuty event", status=400)

        event_type = event.get("event_type") or ""
        event_id = event.get("id").strip() if isinstance(event.get("id"), str) else ""
        if not event_id or len(event_id) > 256:
            return _bad("Valid PagerDuty event id is required")
        if event_type not in PAGERDUTY_EVENTS:
            return _bad("Unsupported PagerDuty event")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        incident_id = data.get("id").strip() if isinstance(data.get("id"), str) else ""
        if not incident_id or len(incident_id) > 256:
            return _bad("Valid PagerDuty incident id is required")
        if data.get("type") != "incident":
            return _bad("PagerDuty event is not an incident")
        status = data.get("status").strip().lower() if isinstance(data.get("status"), str) else ""
        if status not in ("triggered", "acknowledged", "resolved"):
            return _bad("Invalid PagerDuty incident status")
        expected = {"incident.acknowledged": "acknowledged", "incident.resolved": "resolved"}.get(
            event_type, "triggered"
        )
        if status != expected:
            return _bad("PagerDuty event and incident status do not match")
        occurred_at = event.get("occurred_at")
        if not isinstance(occurred_at, str) or not OFFSET_TS.match(occurred_at) or not _parses(occurred_at):
            return _bad("Invalid PagerDuty event timestamp")

        service = data.get("service") if isinstance(data.get("service"), dict) else {}
        html_url = data.get("html_url") if isinstance(data.get("html_url"), str) else ""
        parts = urlsplit(html_url) if html_url else None
        host = (parts.hostname or "") if parts else ""
        safe_url = (
            html_url
            if parts and parts.scheme == "https" and (host == "pagerduty.com" or host.endswith(".pagerduty.com"))
            else ""
        )
        record = {
            "id": incident_id,
            "title": data["title"] if isinstance(data.get("title"), str) else "PagerDuty incident",
            "status": status,
            "urgency": data["urgency"] if isinstance(data.get("urgency"), str) else "high",
            "html_url": safe_url,
            "service": service["summary"][:100] if isinstance(service.get("summary"), str) else "",
            "event_type": event_type,
            "event_id": event_id,
            "occurred_at": occurred_at,
        }
        act_as_service()
        try:
            with transaction.atomic():
                saved = call_function(
                    "itsm_upsert_pagerduty_incident",
                    [("_org_id", settings.INTEGRATION_ORG_ID, "uuid"), ("_input", jsonb(record), "jsonb")],
                )
        except DatabaseError as error:
            log.error("pagerduty incident failed %s: %s", incident_id, error)
            return JsonResponse({"error": "Not saved"}, status=500)
        return JsonResponse(saved, safe=False)


def _parses(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("z", "Z").replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


class SecurityFindingsView(View):
    """Scanner intake, signed with x-argus-signature. Dedupes on scanner + reference + asset in SQL."""

    http_method_names = ["post"]

    def post(self, request):
        secret = settings.SECURITY_SCANNER_SECRET
        if not secret:
            return HttpResponse("Scanner intake is not configured", status=503)
        body = read_body(request)
        if isinstance(body, HttpResponse):
            return body
        if not scanner_signature_valid(body, request.headers.get("X-Argus-Signature", ""), secret):
            return HttpResponse("Invalid signature", status=401)
        payload = parse_json(body)
        if payload is None:
            return HttpResponse("Invalid JSON", status=400)
        envelope = ScannerPayloadSerializer(data=payload)
        if not envelope.is_valid():
            return JsonResponse({"error": "Invalid payload", "issues": envelope.errors}, status=400)
        findings = []
        for index, item in enumerate(envelope.validated_data["findings"]):
            finding = ScannerFindingSerializer(data=item)
            if not finding.is_valid():
                return JsonResponse(
                    {"error": "Invalid payload", "issues": {f"findings.{index}": finding.errors}}, status=400
                )
            findings.append(finding.to_json())

        act_as_service()
        results = []
        for finding in findings:
            summary = {
                "scanner": finding["scanner"],
                "reference": finding["reference"],
                "asset": finding.get("asset", ""),
            }
            try:
                with transaction.atomic():
                    saved = call_function(
                        "itsm_upsert_scanner_finding",
                        [
                            ("_org_id", settings.INTEGRATION_ORG_ID, "uuid"),
                            ("_input", jsonb(finding), "jsonb"),
                        ],
                    )
                results.append({**summary, "id": saved["id"], "number": saved["number"], "created": saved["created"]})
            except DatabaseError as error:
                log.error("scanner finding failed: %s", getattr(error.__cause__, "sqlstate", error))
                results.append({**summary, "error": "Not saved; check workspace asset, service and owner identifiers."})
        failed = sum(1 for r in results if "error" in r)
        status = 422 if failed == len(results) else 207 if failed else 200
        return JsonResponse(
            {"results": results, "saved": len(results) - failed, "failed": failed},
            status=status,
            headers=NO_STORE,
        )
