from datetime import UTC, datetime

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all, fetch_one, like_pattern
from apps.core.views import CallerAPIView

from .serializers import IncidentUpdateSerializer, SelfServiceIncidentSerializer
from .workflow import CONFLICT_MESSAGE, Conflict, WorkflowError, build_patch

STATES = {"new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"}
LIST_COLUMNS = """
  i.id, i.number, i.title, i.state::text AS state, i.priority, i.impact, i.urgency, i.category,
  i.contact_type, i.major_incident, i.sla_due_at, i.created_at, i.updated_at,
  i.requester_id, i.assignee_id, i.group_id, i.service_id
"""


class IncidentListView(CallerAPIView):
    # RLS decides which rows a requester sees (their own); staff see the workspace queue.
    policy_actions = {"GET": "incident.list", "POST": "incident.create_self_service"}

    def get(self, request, org_id):
        clauses = ["i.organization_id = %s"]
        params: list = [self.org_id]
        state = request.query_params.get("state")
        if state:
            wanted = [s for s in state.split(",") if s in STATES]
            if not wanted:
                return Response({"detail": "Unknown state filter."}, status=400)
            clauses.append("i.state::text = ANY(%s)")
            params.append(wanted)
        query = (request.query_params.get("q") or "").strip()[:120]
        if query:
            clauses.append("(i.number ILIKE %s OR i.title ILIKE %s)")
            like = like_pattern(query)
            params += [like, like]
        try:
            limit = min(max(int(request.query_params.get("limit", 100)), 1), 500)
        except ValueError:
            limit = 100
        rows = fetch_all(
            f"SELECT {LIST_COLUMNS} FROM public.incidents i WHERE {' AND '.join(clauses)} "
            "ORDER BY i.created_at DESC LIMIT %s",
            [*params, limit],
        )
        return Response({"results": rows})

    def post(self, request, org_id):
        data = SelfServiceIncidentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        result = call_function(
            "itsm_self_service_incident",
            [
                ("_org_id", self.org_id, "uuid"),
                ("_title", v["title"], "text"),
                ("_description", v["description"], "text"),
                ("_impact", v["impact"], "smallint"),
                ("_urgency", v["urgency"], "smallint"),
                ("_category", v["category"], "text"),
                ("_subcategory", v["subcategory"], "text"),
                ("_contact_type", v["contactType"], "text"),
            ],
        )
        return Response(result, status=status.HTTP_201_CREATED)


DETAIL_COLUMNS = (
    f"{LIST_COLUMNS}, i.description, i.subcategory, i.on_hold_reason, i.close_code, i.resolution_notes, "
    "i.resolved_at, i.first_responded_at, i.reopen_count, i.problem_id, g.name AS group_name, "
    "p.display_name AS assignee_name"
)
# Columns build_patch may produce; the SET clause is built only from this list.
PATCHABLE = {
    "state": "%s::public.record_state",
    "assignee_id": "%s::uuid",
    "group_id": "%s::uuid",
    "impact": "%s::smallint",
    "urgency": "%s::smallint",
    "category": "%s",
    "subcategory": "%s",
    "close_code": "%s",
    "on_hold_reason": "%s",
    "resolution_notes": "%s",
    "resolved_at": "%s::timestamptz",
    "reopen_count": "%s::integer",
    "first_responded_at": "%s::timestamptz",
}


def load_incident(org_id: str, incident_id) -> dict:
    row = fetch_one(
        f"SELECT {DETAIL_COLUMNS} FROM public.incidents i "
        "LEFT JOIN public.groups g ON g.id = i.group_id LEFT JOIN public.profiles p ON p.id = i.assignee_id "
        "WHERE i.organization_id = %s AND i.id = %s",
        [org_id, str(incident_id)],
    )
    if not row:
        raise Http404
    return row


class IncidentDetailView(CallerAPIView):
    policy_actions = {"GET": "incident.read", "PATCH": "incident.update"}

    def get(self, request, org_id, incident_id):
        return Response(load_incident(self.org_id, incident_id))

    def patch(self, request, org_id, incident_id):
        data = IncidentUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        current = fetch_one(
            "SELECT state::text AS state, updated_at, first_responded_at, reopen_count, resolved_at, "
            "resolution_notes, close_code, on_hold_reason FROM public.incidents WHERE organization_id = %s AND id = %s",
            [self.org_id, str(incident_id)],
        )
        if not current:
            raise Http404
        try:
            patch = build_patch(current, dict(data.validated_data), request.user.user_id, datetime.now(UTC))
        except Conflict as error:
            return Response({"detail": str(error)}, status=status.HTTP_409_CONFLICT)
        except WorkflowError as error:
            return Response({"detail": str(error)}, status=400)
        if patch.get("group_id") and not fetch_one(
            "SELECT 1 AS ok FROM public.groups WHERE organization_id = %s AND id = %s AND is_active",
            [self.org_id, patch["group_id"]],
        ):
            return Response({"detail": "The selected group is not available in this organization."}, status=400)
        if patch:
            columns = sorted(patch)
            assignments = ", ".join(f"{c} = {PATCHABLE[c]}" for c in columns)
            # validate_incident_workflow re-checks every rule; the version check stops lost updates.
            updated = fetch_one(
                f"UPDATE public.incidents SET {assignments} "
                "WHERE organization_id = %s AND id = %s AND updated_at = %s RETURNING id",
                [*(patch[c] for c in columns), self.org_id, str(incident_id), current["updated_at"]],
            )
            if not updated:
                return Response({"detail": CONFLICT_MESSAGE}, status=status.HTTP_409_CONFLICT)
        return Response(load_incident(self.org_id, incident_id))
