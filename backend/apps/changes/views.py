from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all, fetch_one, jsonb, like_pattern
from apps.core.views import CallerAPIView

from .serializers import STATES, ChangeActionSerializer, ChangeInputSerializer

LIST_COLUMNS = """
  c.id, c.number, c.title, c.change_type, c.risk, c.state::text AS state, c.approval_status,
  c.start_at, c.end_at, c.expected_outage_minutes, c.created_at, c.updated_at, c.requester_id, c.owner_id,
  c.service_id, s.name AS service_name
"""
FROM = "FROM public.changes c LEFT JOIN public.services s ON s.id = c.service_id"


class ChangeError(Exception):
    pass


def lifecycle_patch(current: dict, action: str, v: dict) -> tuple[list[str], list]:
    """The same gates as the legacy updateChange server function. Returns SET clauses and params."""
    if action == "start":
        if current["state"] != "open" or current["approval_status"] not in ("approved", "not_required"):
            raise ChangeError("The change must be approved and scheduled before implementation starts.")
        if current["window_open"] is False:
            raise ChangeError("Implementation cannot start before the scheduled window.")
        return ["state = 'in_progress'", "actual_start_at = now()"], []
    if action == "deliver":
        if current["state"] != "in_progress":
            raise ChangeError("Start implementation before recording delivery.")
        if (
            not v.get("deliveryOutcome")
            or not (v.get("validationResults") or "").strip()
            or not (v.get("pirNotes") or "").strip()
        ):
            raise ChangeError("Delivery outcome, validation results, and review notes are required.")
        return (
            [
                "state = 'resolved'",
                "actual_end_at = now()",
                "delivered_at = now()",
                "delivery_outcome = %s",
                "validation_results = %s",
                "rollback_used = %s",
                "pir_notes = %s",
            ],
            [v["deliveryOutcome"], v["validationResults"], v.get("rollbackUsed", False), v["pirNotes"]],
        )
    if action == "close":
        if current["state"] != "resolved" or not current["pir_notes"] or not current["validation_results"]:
            raise ChangeError("Delivery evidence and a post-implementation review are required before closure.")
        return ["state = 'closed'", "closed_at = now()"], []
    if current["state"] in ("resolved", "closed"):
        raise ChangeError("A delivered change cannot be cancelled.")
    return ["state = 'cancelled'"], []


class ChangeListView(CallerAPIView):
    policy_actions = {"GET": "change.list", "POST": "change.create"}

    def get(self, request, org_id):
        clauses = ["c.organization_id = %s"]
        params: list = [self.org_id]
        state = request.query_params.get("state")
        if state:
            wanted = [s for s in state.split(",") if s in STATES]
            if not wanted:
                return Response({"detail": "Unknown state filter."}, status=400)
            clauses.append("c.state::text = ANY(%s)")
            params.append(wanted)
        query = (request.query_params.get("q") or "").strip()[:120]
        if query:
            clauses.append("(c.number ILIKE %s OR c.title ILIKE %s)")
            params += [like_pattern(query)] * 2
        rows = fetch_all(
            f"SELECT {LIST_COLUMNS} {FROM} WHERE {' AND '.join(clauses)} "
            "ORDER BY c.start_at NULLS LAST, c.created_at DESC LIMIT 200",
            params,
        )
        return Response({"results": rows})

    def post(self, request, org_id):
        data = ChangeInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = call_function(
            "itsm_create_change", [("_org_id", self.org_id, "uuid"), ("_input", jsonb(data.to_json()), "jsonb")]
        )
        return Response(result, status=status.HTTP_201_CREATED)


def load_change(org_id: str, change_id) -> dict:
    row = fetch_one(
        f"SELECT {LIST_COLUMNS}, c.description, c.implementation_plan, c.test_plan, c.rollback_plan, "
        "c.business_justification, c.impact_assessment, c.validation_plan, c.rollback_trigger, "
        "c.communication_plan, c.affected_ci_ids, c.actual_start_at, c.actual_end_at, c.delivery_outcome, "
        f"c.validation_results, c.rollback_used, c.pir_notes, c.delivered_at, c.closed_at {FROM} "
        "WHERE c.organization_id = %s AND c.id = %s",
        [org_id, str(change_id)],
    )
    if not row:
        raise Http404
    row["approvals"] = fetch_all(
        "SELECT a.id, a.approver_id, p.display_name AS approver_name, a.status, a.decision_notes, a.decided_at "
        "FROM public.approvals a LEFT JOIN public.profiles p ON p.id = a.approver_id "
        "WHERE a.organization_id = %s AND a.record_type = 'change' AND a.record_id = %s ORDER BY a.created_at",
        [org_id, str(change_id)],
    )
    return row


class ChangeDetailView(CallerAPIView):
    policy_actions = {"GET": "change.read"}

    def get(self, request, org_id, change_id):
        return Response(load_change(self.org_id, change_id))


class ChangeActionView(CallerAPIView):
    policy_actions = {"POST": "change.update"}

    def post(self, request, org_id, change_id):
        data = ChangeActionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        current = fetch_one(
            "SELECT state::text AS state, approval_status, pir_notes, validation_results, updated_at, "
            "(start_at IS NULL OR start_at <= now()) AS window_open "
            "FROM public.changes WHERE organization_id = %s AND id = %s",
            [self.org_id, str(change_id)],
        )
        if not current:
            raise Http404
        try:
            sets, params = lifecycle_patch(current, v["action"], v)
        except ChangeError as error:
            return Response({"detail": str(error)}, status=400)
        updated = fetch_one(
            f"UPDATE public.changes SET {', '.join(sets)} "
            "WHERE organization_id = %s AND id = %s AND updated_at = %s RETURNING id",
            [*params, self.org_id, str(change_id), current["updated_at"]],
        )
        if not updated:
            return Response(
                {"detail": "This change was updated by another person. Refresh and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(load_change(self.org_id, change_id))
