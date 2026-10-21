"""Comments on incidents and requests. RLS decides who sees a record's comments and hides internal
(staff-only) notes from requesters; adding an internal note as a requester fails in the database."""

from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import execute, fetch_all, fetch_one
from apps.core.views import CallerAPIView

RECORD_TABLES = {"incident": "incidents", "request": "service_requests"}


class CommentSerializer(serializers.Serializer):
    body = serializers.CharField(min_length=1, max_length=4000)
    internal = serializers.BooleanField(default=False)


class CommentsView(CallerAPIView):
    policy_actions = {"GET": "comment.read", "POST": "comment.create"}

    def record_exists(self, record_type: str, record_id) -> bool:
        table = RECORD_TABLES[record_type]
        return bool(
            fetch_one(
                f"SELECT 1 AS ok FROM public.{table} WHERE organization_id = %s AND id = %s",
                [self.org_id, str(record_id)],
            )
        )

    def comments(self, record_type: str, record_id) -> list[dict]:
        return fetch_all(
            "SELECT c.id, c.body, c.internal, c.created_at, c.author_id, p.display_name AS author_name "
            "FROM public.record_comments c LEFT JOIN public.profiles p ON p.id = c.author_id "
            "WHERE c.organization_id = %s AND c.record_type = %s AND c.record_id = %s ORDER BY c.created_at",
            [self.org_id, record_type, str(record_id)],
        )

    def get(self, request, org_id, record_type, record_id):
        if not self.record_exists(record_type, record_id):
            return Response({"detail": "Not found."}, status=404)
        return Response({"results": self.comments(record_type, record_id)})

    def post(self, request, org_id, record_type, record_id):
        if not self.record_exists(record_type, record_id):
            return Response({"detail": "Not found."}, status=404)
        data = CommentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        params = [self.org_id, record_type, str(record_id), request.user.user_id]
        fetch_one(
            "INSERT INTO public.record_comments(organization_id, record_type, record_id, author_id, body, internal) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            [*params, data.validated_data["body"].strip(), data.validated_data["internal"]],
        )
        # The audit_create policy allows exactly this event for records the caller can access. No RETURNING:
        # requesters may write the event but not read the audit log back.
        execute(
            "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source) "
            "VALUES (%s, %s, %s, %s, 'comment_added', 'application')",
            params,
        )
        return Response({"results": self.comments(record_type, record_id)}, status=status.HTTP_201_CREATED)
