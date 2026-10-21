"""Workspace administration (legacy /administration and /accept-invitation) and the audit trail.

Every change goes through the itsm_admin_* security-definer functions, which lock the workspace, re-check the
caller's active administrator role, check versions and write immutable administration audit evidence."""

from rest_framework import exceptions, status
from rest_framework.response import Response

from apps.core.db import call_function, fetch_all
from apps.core.views import CallerAPIView

from .serializers import (
    InviteSerializer,
    RevokeInvitationSerializer,
    SaveGroupSerializer,
    UpdateMemberSerializer,
    UpdateWorkspaceSerializer,
)

ORG = "_org_id"


class AdministrationView(CallerAPIView):
    policy_actions = {"GET": "admin.read"}

    def get(self, request, org_id):
        return Response(call_function("itsm_admin_overview", [(ORG, self.org_id, "uuid")]))


class InvitationsView(CallerAPIView):
    policy_actions = {"POST": "admin.invite"}

    def post(self, request, org_id):
        data = InviteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = call_function(
            "itsm_admin_invite",
            [
                (ORG, self.org_id, "uuid"),
                ("_email", data.validated_data["email"], "text"),
                ("_roles", data.validated_data["roles"], "app_role[]"),
            ],
        )
        return Response(result, status=status.HTTP_201_CREATED)


class RevokeInvitationView(CallerAPIView):
    policy_actions = {"POST": "admin.revoke_invitation"}

    def post(self, request, org_id, invitation_id):
        data = RevokeInvitationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return Response(
            call_function(
                "itsm_admin_revoke_invitation",
                [
                    (ORG, self.org_id, "uuid"),
                    ("_invitation_id", str(invitation_id), "uuid"),
                    ("_expected_version", data.validated_data["expectedVersion"], "integer"),
                ],
            )
        )


class MemberView(CallerAPIView):
    policy_actions = {"PATCH": "admin.update_member"}

    def patch(self, request, org_id, user_id):
        data = UpdateMemberSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        return Response(
            call_function(
                "itsm_admin_update_member",
                [
                    (ORG, self.org_id, "uuid"),
                    ("_user_id", str(user_id), "uuid"),
                    ("_roles", v["roles"], "app_role[]"),
                    ("_is_active", v["isActive"], "boolean"),
                    ("_expected_version", v["expectedVersion"], "integer"),
                ],
            )
        )


def save_group(org_id: str, group_id: str | None, v: dict):
    return call_function(
        "itsm_admin_save_group",
        [
            (ORG, org_id, "uuid"),
            ("_group_id", group_id, "uuid"),
            ("_name", v["name"].strip(), "text"),
            ("_description", v["description"].strip(), "text"),
            ("_is_active", v["isActive"], "boolean"),
            ("_member_ids", v["memberIds"], "uuid[]"),
            ("_expected_version", v.get("expectedVersion"), "integer"),
        ],
    )


class GroupsView(CallerAPIView):
    policy_actions = {"POST": "admin.save_group"}

    def post(self, request, org_id):
        data = SaveGroupSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if "expectedVersion" in data.validated_data:
            raise exceptions.ValidationError({"expectedVersion": "Only send a version when editing a group."})
        return Response(save_group(self.org_id, None, data.validated_data), status=status.HTTP_201_CREATED)


class GroupView(CallerAPIView):
    policy_actions = {"PUT": "admin.save_group"}

    def put(self, request, org_id, group_id):
        data = SaveGroupSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if "expectedVersion" not in data.validated_data:
            raise exceptions.ValidationError({"expectedVersion": "Refresh the group before saving."})
        return Response(save_group(self.org_id, str(group_id), data.validated_data))


class WorkspaceSettingsView(CallerAPIView):
    policy_actions = {"PATCH": "admin.update_workspace"}

    def patch(self, request, org_id):
        data = UpdateWorkspaceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        return Response(
            call_function(
                "itsm_admin_update_workspace",
                [
                    (ORG, self.org_id, "uuid"),
                    ("_name", v["name"].strip(), "text"),
                    ("_timezone", v["timezone"].strip(), "text"),
                    ("_expected_version", v["expectedVersion"], "integer"),
                ],
            )
        )


EMAIL_MISMATCH = "Sign in with the verified email address that received this invitation"


class InvitationView(CallerAPIView):
    """Opened by someone who is not a member yet, so there is no workspace in the path."""

    policy_actions = {"GET": "invitation.read", "POST": "invitation.accept"}

    def check_token_email(self, invitation: dict) -> None:
        # The database compares with auth.users, linked from Keycloak at first sign-in. Also require the current
        # token's verified email, so an address changed later in Keycloak cannot use an invitation sent to the old one.
        principal = self.request.user
        if not principal.email_verified or (principal.email or "").strip().lower() != invitation["email"]:
            raise exceptions.PermissionDenied(EMAIL_MISMATCH)

    def details(self, invitation_id) -> dict:
        invitation = call_function("itsm_get_invitation", [("_invitation_id", str(invitation_id), "uuid")])
        self.check_token_email(invitation)
        return invitation

    def get(self, request, invitation_id):
        return Response(self.details(invitation_id))

    def post(self, request, invitation_id):
        self.details(invitation_id)
        return Response(call_function("itsm_accept_invitation", [("_invitation_id", str(invitation_id), "uuid")]))


AUDIT_PAGE = 50


class AuditView(CallerAPIView):
    """Read-only. RLS shows administration evidence to admins only and operational audit to staff."""

    policy_actions = {"GET": "audit.read"}

    def get(self, request, org_id):
        clauses = ["a.organization_id = %s"]
        params: list = [self.org_id]
        for param, column, limit in (("recordType", "a.record_type", 40), ("action", "a.action", 60)):
            value = (request.query_params.get(param) or "").strip()[:limit]
            if value:
                clauses.append(f"{column} = %s")
                params.append(value)
        record_id = request.query_params.get("recordId")
        if record_id:
            clauses.append("a.record_id = %s::uuid")
            params.append(record_id)
        before = request.query_params.get("before")
        if before:
            # Keyset cursor "<created_at>|<id>" from the previous page; stable while new events arrive.
            created, _, last_id = before.partition("|")
            if not created or not last_id:
                raise exceptions.ValidationError({"before": "Invalid page cursor."})
            clauses.append("(a.created_at, a.id) < (%s::timestamptz, %s::uuid)")
            params += [created, last_id]
        rows = fetch_all(
            "SELECT a.id, a.record_type, a.record_id, a.actor_id, p.display_name AS actor_name, a.action, a.source, "
            "a.before_values, a.after_values, a.created_at FROM public.audit_events a "
            "LEFT JOIN public.profiles p ON p.id = a.actor_id "
            f"WHERE {' AND '.join(clauses)} ORDER BY a.created_at DESC, a.id DESC LIMIT %s",
            [*params, AUDIT_PAGE + 1],
        )
        more = len(rows) > AUDIT_PAGE
        rows = rows[:AUDIT_PAGE]
        cursor = f"{rows[-1]['created_at'].isoformat()}|{rows[-1]['id']}" if more else None
        return Response({"results": rows, "next": cursor})


class AuditFacetsView(CallerAPIView):
    """Record types the caller can see in this workspace's audit, for the filter."""

    policy_actions = {"GET": "audit.read"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT DISTINCT record_type FROM public.audit_events WHERE organization_id = %s ORDER BY record_type",
            [self.org_id],
        )
        return Response({"recordTypes": [r["record_type"] for r in rows]})
