"""Operator-raised incidents (legacy createIncident) and queue totals."""

from datetime import UTC, datetime, timedelta

from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_one
from apps.core.views import CallerAPIView

from .queue import queue_counts

CONTACT_TYPES = ["phone", "email", "self_service", "chat", "walk_up"]


class OperatorIncidentSerializer(serializers.Serializer):
    """Port of the createIncident validator, with the legacy contact types as choices."""

    title = serializers.CharField(min_length=5, max_length=160)
    description = serializers.CharField(min_length=5, max_length=6000)
    impact = serializers.IntegerField(min_value=1, max_value=3)
    urgency = serializers.IntegerField(min_value=1, max_value=3)
    serviceId = serializers.UUIDField(required=False, allow_null=True)
    groupId = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.CharField(max_length=40, required=False, allow_blank=True, allow_null=True)
    subcategory = serializers.CharField(max_length=60, required=False, allow_blank=True, allow_null=True)
    contactType = serializers.ChoiceField(choices=CONTACT_TYPES, default="phone")


class OperatorIncidentView(CallerAPIView):
    """Staff log an incident taken by phone, email or at the desk, already routed to a group and service.
    incidents_create RLS requires a staff caller who is recorded as requester, as in the legacy app."""

    policy_actions = {"POST": "incident.create"}

    def post(self, request, org_id):
        data = OperatorIncidentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        group = str(v["groupId"]) if v.get("groupId") else None
        service = str(v["serviceId"]) if v.get("serviceId") else None
        if group and not fetch_one(
            "SELECT 1 AS ok FROM public.groups WHERE organization_id = %s AND id = %s AND is_active",
            [self.org_id, group],
        ):
            return Response({"detail": "The selected group is not available in this organization."}, status=400)
        if service and not fetch_one(
            "SELECT 1 AS ok FROM public.services WHERE organization_id = %s AND id = %s", [self.org_id, service]
        ):
            return Response({"detail": "The selected service is not available in this organization."}, status=400)
        number = call_function("next_record_number", [("_org_id", self.org_id, "uuid"), ("_prefix", "INC", "text")])
        severity = v["impact"] + v["urgency"]
        hours = 2 if severity <= 2 else 8 if severity <= 4 else 24
        row = fetch_one(
            "INSERT INTO public.incidents(organization_id, number, title, description, impact, urgency, requester_id, "
            "service_id, group_id, category, subcategory, contact_type, sla_due_at, state) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'new') RETURNING id, number",
            [
                self.org_id,
                number,
                v["title"].strip(),
                v["description"].strip(),
                v["impact"],
                v["urgency"],
                request.user.user_id,
                service,
                group,
                (v.get("category") or "").strip() or None,
                (v.get("subcategory") or "").strip() or None,
                v["contactType"],
                datetime.now(UTC) + timedelta(hours=hours),
            ],
        )
        return Response(row, status=status.HTTP_201_CREATED)


class QueueCountsView(CallerAPIView):
    policy_actions = {"GET": "incident.list"}

    def get(self, request, org_id):
        return Response(queue_counts(self.org_id, request.user.user_id))
