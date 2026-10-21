"""Security findings board. Tables are read-only to staff through RLS; every state change goes
through the legacy security-definer functions so lifecycle gates, approvals and audit stay atomic."""

from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all, fetch_one, jsonb
from apps.core.views import CallerAPIView

from .serializers import (
    ExceptionDecisionSerializer,
    ExceptionRequestSerializer,
    FindingInputSerializer,
    validate_transition,
)

STAFF_ONLY = "The Security workspace is available to workspace staff only."


class SecurityView(CallerAPIView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # OPA already allowed the action; confirm staff access in the database before any finding or
        # linked record is read, so customers never receive staff-only choices.
        if not call_function("can_manage", [("_org_id", self.org_id, "uuid")]):
            raise exceptions.PermissionDenied(STAFF_ONLY)

    def finding_in_org(self, finding_id) -> dict:
        row = fetch_one(
            "SELECT id, state FROM public.security_findings WHERE id = %s AND organization_id = %s",
            [str(finding_id), self.org_id],
        )
        if not row:
            raise Http404
        return row


class BoardView(SecurityView):
    policy_actions = {"GET": "security.board.read"}

    def get(self, request, org_id):
        org = [self.org_id]
        return Response(
            {
                "findings": fetch_all(
                    "SELECT * FROM public.security_findings WHERE organization_id = %s "
                    "ORDER BY created_at DESC LIMIT 500",
                    org,
                ),
                "exceptions": fetch_all(
                    "SELECT * FROM public.security_exceptions WHERE organization_id = %s "
                    "ORDER BY created_at DESC LIMIT 500",
                    org,
                ),
                "changes": fetch_all(
                    "SELECT id, number, title FROM public.changes WHERE organization_id = %s "
                    "ORDER BY created_at DESC LIMIT 200",
                    org,
                ),
                "incidents": fetch_all(
                    "SELECT id, number, title FROM public.incidents WHERE organization_id = %s "
                    "ORDER BY created_at DESC LIMIT 200",
                    org,
                ),
            }
        )


class FindingCreateView(SecurityView):
    policy_actions = {"POST": "security.finding.create"}

    def post(self, request, org_id):
        data = FindingInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        payload = dict(data.validated_data)
        if payload.get("serviceId") is not None:
            payload["serviceId"] = str(payload["serviceId"])
        result = call_function(
            "itsm_create_security_finding",
            [("_org_id", self.org_id, "uuid"), ("_input", jsonb(payload), "jsonb")],
        )
        return Response(result, status=status.HTTP_201_CREATED)


class FindingTransitionView(SecurityView):
    policy_actions = {"POST": "security.finding.transition"}

    def post(self, request, org_id, finding_id):
        self.finding_in_org(finding_id)
        action, payload = validate_transition(request.data)
        call_function(
            "itsm_transition_security_finding",
            [
                ("_finding_id", str(finding_id), "uuid"),
                ("_action", action, "text"),
                ("_input", jsonb(payload), "jsonb"),
            ],
        )
        return Response(fetch_one("SELECT * FROM public.security_findings WHERE id = %s", [str(finding_id)]))


class ExceptionRequestView(SecurityView):
    policy_actions = {"POST": "security.exception.request"}

    def post(self, request, org_id, finding_id):
        self.finding_in_org(finding_id)
        data = ExceptionRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        call_function(
            "itsm_request_security_exception",
            [
                ("_finding_id", str(finding_id), "uuid"),
                ("_justification", v["justification"], "text"),
                ("_controls", v["compensatingControls"], "text"),
                ("_expires_at", v["expiresAt"], "timestamptz"),
            ],
        )
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


class ExceptionDecisionView(SecurityView):
    policy_actions = {"POST": "security.exception.decide"}

    def post(self, request, org_id, exception_id):
        if not fetch_one(
            "SELECT 1 AS ok FROM public.security_exceptions WHERE id = %s AND organization_id = %s",
            [str(exception_id), self.org_id],
        ):
            raise Http404
        data = ExceptionDecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        call_function(
            "itsm_decide_security_exception",
            [
                ("_exception_id", str(exception_id), "uuid"),
                ("_decision", v["decision"], "text"),
                ("_notes", v["notes"], "text"),
            ],
        )
        return Response({"ok": True})
