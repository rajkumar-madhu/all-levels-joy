"""The signed-in person's own profile and notifications (legacy /profile, header notification bell)."""

import json

from rest_framework import serializers
from rest_framework.response import Response

from apps.core.db import execute, fetch_all, fetch_one
from apps.core.views import CallerAPIView

PROFILE_COLUMNS = "id, display_name, avatar_url, phone, job_title, department, locale, timezone, preferences"


class ProfileSerializer(serializers.Serializer):
    """Port of the updateProfile validator in src/lib/itsm.functions.ts."""

    displayName = serializers.CharField(min_length=2, max_length=120)
    phone = serializers.CharField(max_length=40, allow_blank=True, default="")
    jobTitle = serializers.CharField(max_length=120, allow_blank=True, default="")
    department = serializers.CharField(max_length=120, allow_blank=True, default="")
    locale = serializers.CharField(min_length=2, max_length=20)
    timezone = serializers.CharField(min_length=2, max_length=60)
    avatarUrl = serializers.URLField(max_length=500, required=False, allow_blank=True, allow_null=True)
    emailDigest = serializers.BooleanField()


class ProfileView(CallerAPIView):
    # Your own profile only: RLS lets a person read and write the row whose id is theirs.
    policy_actions = {"GET": "profile.read", "PATCH": "profile.update"}

    def load(self, user_id: str) -> dict:
        row = fetch_one(f"SELECT {PROFILE_COLUMNS} FROM public.profiles WHERE id = %s", [user_id])
        return row or {"id": user_id, "display_name": None, "preferences": {}}

    def get(self, request):
        return Response({**self.load(request.user.user_id), "email": request.user.email})

    def patch(self, request):
        data = ProfileSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        user_id = request.user.user_id
        values = [
            v["displayName"].strip(),
            v["phone"].strip() or None,
            v["jobTitle"].strip() or None,
            v["department"].strip() or None,
            v["locale"].strip(),
            v["timezone"].strip(),
            (v.get("avatarUrl") or "").strip() or None,
            json.dumps({"emailDigest": v["emailDigest"]}),
        ]
        execute(
            "INSERT INTO public.profiles(id, display_name, phone, job_title, department, locale, timezone, avatar_url, "
            "preferences) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) ON CONFLICT (id) DO UPDATE SET "
            "display_name = EXCLUDED.display_name, phone = EXCLUDED.phone, job_title = EXCLUDED.job_title, "
            "department = EXCLUDED.department, locale = EXCLUDED.locale, timezone = EXCLUDED.timezone, "
            "avatar_url = EXCLUDED.avatar_url, preferences = EXCLUDED.preferences",
            [user_id, *values],
        )
        # A profile spans workspaces, so the change is recorded in each workspace the person belongs to.
        for workspace in request.user.workspaces:
            execute(
                "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source) "
                "VALUES (%s, 'profile', %s, %s, 'updated', 'application')",
                [workspace.id, user_id, user_id],
            )
        return Response({**self.load(user_id), "email": request.user.email})


class NotificationsView(CallerAPIView):
    """The 20 most recent notifications for the caller in this workspace. Reading them does not mark them read."""

    policy_actions = {"GET": "notification.read"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT id, title, body, record_type, record_id, read_at, created_at FROM public.notifications "
            "WHERE organization_id = %s AND user_id = %s ORDER BY created_at DESC, id DESC LIMIT 20",
            [self.org_id, request.user.user_id],
        )
        return Response({"results": rows, "unreadRecent": sum(1 for r in rows if r["read_at"] is None)})


class MarkNotificationsReadView(CallerAPIView):
    policy_actions = {"POST": "notification.update"}

    def post(self, request, org_id):
        updated = execute(
            "UPDATE public.notifications SET read_at = now() "
            "WHERE organization_id = %s AND user_id = %s AND read_at IS NULL",
            [self.org_id, request.user.user_id],
        )
        return Response({"ok": True, "marked": updated})
