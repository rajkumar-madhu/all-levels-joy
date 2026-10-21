from rest_framework.response import Response

from apps.core.db import call_function, fetch_all, fetch_one
from apps.core.permissions import IsAuthenticatedPrincipal
from apps.core.views import CallerAPIView


class MeView(CallerAPIView):
    """Who is signed in and which workspaces they can open. Needs no workspace policy."""

    permission_classes = [IsAuthenticatedPrincipal]

    def get(self, request):
        principal = request.user
        profile = fetch_one(
            "SELECT display_name, avatar_url, job_title, timezone FROM public.profiles WHERE id = %s",
            [principal.user_id],
        )
        return Response(
            {
                "user_id": principal.user_id,
                "email": principal.email,
                "profile": profile,
                "workspaces": [
                    {
                        "id": w.id,
                        "name": w.name,
                        "slug": w.slug,
                        "roles": list(w.roles),
                        "is_staff": w.is_staff,
                    }
                    for w in principal.workspaces
                ],
            }
        )


class BootstrapView(CallerAPIView):
    """Creates the caller's profile and requester role after admission (legacy bootstrap_workspace)."""

    permission_classes = [IsAuthenticatedPrincipal]

    def post(self, request):
        display_name = request.data.get("displayName") if isinstance(request.data, dict) else None
        if display_name is not None and not isinstance(display_name, str):
            return Response({"detail": "displayName must be text."}, status=400)
        return Response(call_function("bootstrap_workspace", [("_display_name", display_name, "text")]))


class GroupsView(CallerAPIView):
    """Active assignment groups, for routing incidents and requests."""

    policy_actions = {"GET": "group.read"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT id, name, description FROM public.groups WHERE organization_id = %s AND is_active ORDER BY name",
            [str(org_id)],
        )
        return Response({"results": rows})
