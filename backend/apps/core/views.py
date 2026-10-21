from django.db import connection
from django.http import JsonResponse
from rest_framework.views import APIView

from .db import act_as_user
from .permissions import PolicyPermission


def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"ok": True})


class CallerAPIView(APIView):
    """Authenticated view whose SQL runs as the caller (RLS applies) after OPA allowed the action."""

    permission_classes = [PolicyPermission]
    policy_actions: dict[str, str] = {}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        act_as_user(request.user.user_id)

    @property
    def org_id(self) -> str:
        return str(self.kwargs["org_id"])
