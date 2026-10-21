from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all, fetch_one, like_pattern
from apps.core.views import CallerAPIView

from .serializers import SelfServiceIncidentSerializer

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


class IncidentDetailView(CallerAPIView):
    policy_actions = {"GET": "incident.read"}

    def get(self, request, org_id, incident_id):
        row = fetch_one(
            f"SELECT {LIST_COLUMNS}, i.description, i.subcategory, i.on_hold_reason, i.close_code, "
            "i.resolution_notes, i.resolved_at, i.first_responded_at, i.reopen_count, i.problem_id "
            "FROM public.incidents i WHERE i.organization_id = %s AND i.id = %s",
            [self.org_id, str(incident_id)],
        )
        if not row:
            raise Http404
        return Response(row)
