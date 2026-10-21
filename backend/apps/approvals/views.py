from rest_framework import serializers
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all
from apps.core.views import CallerAPIView


class DecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approved", "rejected"])
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["decision"] == "rejected" and not attrs["notes"].strip():
            raise serializers.ValidationError({"notes": "Decision notes are required when rejecting a record."})
        return attrs


class MyApprovalsView(CallerAPIView):
    """Approvals assigned to the caller, newest first, with the record they decide."""

    policy_actions = {"GET": "approval.list"}

    def get(self, request, org_id):
        status = request.query_params.get("status", "requested")
        if status not in ("requested", "approved", "rejected", "cancelled", "all"):
            return Response({"detail": "Unknown status filter."}, status=400)
        rows = fetch_all(
            """
            SELECT a.id, a.record_type, a.record_id, a.status, a.decision_notes, a.decided_at, a.created_at,
                   coalesce(r.number, c.number) AS record_number, coalesce(r.title, c.title) AS record_title,
                   coalesce(r.requester_id, c.requester_id) AS requester_id,
                   c.risk, c.change_type, c.start_at, c.end_at, r.catalog_item_id
            FROM public.approvals a
            LEFT JOIN public.service_requests r ON a.record_type = 'request' AND r.id = a.record_id
            LEFT JOIN public.changes c ON a.record_type = 'change' AND c.id = a.record_id
            WHERE a.organization_id = %s AND a.approver_id = %s AND (%s = 'all' OR a.status = %s)
            ORDER BY a.created_at DESC LIMIT 200
            """,
            [self.org_id, request.user.user_id, status, status],
        )
        return Response({"results": rows})


class DecideApprovalView(CallerAPIView):
    # itsm_decide_approval checks the caller is the designated, active, independent approver.
    policy_actions = {"POST": "approval.decide"}

    def post(self, request, org_id, approval_id):
        data = DecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not fetch_all(
            "SELECT 1 FROM public.approvals WHERE id = %s AND organization_id = %s", [str(approval_id), self.org_id]
        ):
            return Response({"detail": "Not found."}, status=404)
        call_function(
            "itsm_decide_approval",
            [
                ("_approval_id", str(approval_id), "uuid"),
                ("_decision", data.validated_data["decision"], "text"),
                ("_notes", data.validated_data["notes"], "text"),
            ],
        )
        return Response({"ok": True})
