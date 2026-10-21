from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all, fetch_one, like_pattern
from apps.core.views import CallerAPIView

from .serializers import STATES, ServiceRequestInputSerializer, ServiceRequestUpdateSerializer

REQUEST_COLUMNS = """
  r.id, r.number, r.title, r.state::text AS state, r.approval_status, r.priority, r.due_at,
  r.awaiting_customer_since, r.created_at, r.updated_at, r.requester_id, r.assignee_id, r.group_id,
  r.catalog_item_id, c.name AS catalog_item_name, g.name AS group_name
"""
REQUEST_FROM = """
  FROM public.service_requests r
  LEFT JOIN public.catalog_items c ON c.id = r.catalog_item_id
  LEFT JOIN public.groups g ON g.id = r.group_id
"""


class CatalogView(CallerAPIView):
    policy_actions = {"GET": "catalog.read"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT c.id, c.name, c.category, c.description, c.delivery_days, c.approval_required, "
            "c.default_priority, g.name AS group_name FROM public.catalog_items c "
            "LEFT JOIN public.groups g ON g.id = c.default_group_id "
            "WHERE c.organization_id = %s AND c.active ORDER BY c.category, c.name",
            [self.org_id],
        )
        return Response({"results": rows})


class RequestListView(CallerAPIView):
    # RLS shows requesters their own requests and staff the whole queue.
    policy_actions = {"GET": "request.list", "POST": "request.create"}

    def get(self, request, org_id):
        clauses = ["r.organization_id = %s"]
        params: list = [self.org_id]
        state = request.query_params.get("state")
        if state:
            wanted = [s for s in state.split(",") if s in STATES]
            if not wanted:
                return Response({"detail": "Unknown state filter."}, status=400)
            clauses.append("r.state::text = ANY(%s)")
            params.append(wanted)
        query = (request.query_params.get("q") or "").strip()[:120]
        if query:
            clauses.append("(r.number ILIKE %s OR r.title ILIKE %s)")
            params += [like_pattern(query)] * 2
        rows = fetch_all(
            f"SELECT {REQUEST_COLUMNS} {REQUEST_FROM} WHERE {' AND '.join(clauses)} "
            "ORDER BY r.created_at DESC LIMIT 200",
            params,
        )
        return Response({"results": rows})

    def post(self, request, org_id):
        data = ServiceRequestInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        result = call_function(
            "itsm_create_service_request",
            [
                ("_org_id", self.org_id, "uuid"),
                ("_catalog_item_id", str(v["catalogItemId"]), "uuid"),
                ("_title", v["title"], "text"),
                ("_description", v["description"], "text"),
            ],
        )
        return Response(result, status=status.HTTP_201_CREATED)


class RequestDetailView(CallerAPIView):
    policy_actions = {"GET": "request.read", "PATCH": "request.update"}

    def load(self, request_id):
        row = fetch_one(
            f"SELECT {REQUEST_COLUMNS}, r.description {REQUEST_FROM} WHERE r.organization_id = %s AND r.id = %s",
            [self.org_id, str(request_id)],
        )
        if not row:
            raise Http404
        row["approvals"] = fetch_all(
            "SELECT a.id, a.approver_id, p.display_name AS approver_name, a.status, a.decision_notes, a.decided_at "
            "FROM public.approvals a LEFT JOIN public.profiles p ON p.id = a.approver_id "
            "WHERE a.organization_id = %s AND a.record_type = 'request' AND a.record_id = %s ORDER BY a.created_at",
            [self.org_id, str(request_id)],
        )
        return row

    def get(self, request, org_id, request_id):
        return Response(self.load(request_id))

    def patch(self, request, org_id, request_id):
        data = ServiceRequestUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        sets, params = ["state = %s::public.record_state"], [v["state"]]
        if "awaitingCustomer" in v:
            sets.append("awaiting_customer_since = CASE WHEN %s THEN now() ELSE NULL END")
            params.append(v["awaitingCustomer"])
        # Approval gates and assignment-group rules are enforced by the table's triggers.
        updated = fetch_one(
            f"UPDATE public.service_requests SET {', '.join(sets)} "
            "WHERE organization_id = %s AND id = %s AND updated_at = %s RETURNING id",
            [*params, self.org_id, str(request_id), v["expectedUpdatedAt"]],
        )
        if not updated:
            return Response(
                {"detail": "This request changed or is no longer accessible. Refresh and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(self.load(request_id))
