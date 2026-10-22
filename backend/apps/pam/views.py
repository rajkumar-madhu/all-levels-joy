"""Privileged access: vaulted secrets, time-boxed access requests, rotation and verification.

Staff read secret metadata through RLS. Custodians (managers, administrators) manage secrets and decide
requests. Passwords are only decrypted in the service role: for an approved requester inside their
window, and for rotation and verification. Every one of those writes an append-only event.
"""

import uuid
from collections import Counter

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.db import call_function, execute, fetch_all, fetch_one
from apps.core.exceptions import Conflict
from apps.core.views import CallerAPIView

from . import crypto, vault
from .serializers import (
    ENVIRONMENTS,
    PRODUCTION_APPROVAL,
    RISKS,
    AccessRequestSerializer,
    BulkSerializer,
    DecisionSerializer,
    PasswordSerializer,
    SecretCreateSerializer,
    SecretUpdateSerializer,
)
from .tasks import rotate_secret

CONFLICT_MESSAGE = "This secret changed after you opened it. Refresh and review the latest values before saving."
AUTO_APPROVED = "auto-approved: no approval required"
COLUMNS = """
  s.id, s.name, s.host, s.port, s.username, s.template, s.environment, s.folder, s.description,
  s.owner_group_id, g.name AS owner_group_name, s.approval_required, s.max_checkout_minutes, s.rotation_enabled,
  s.rotation_interval_days, s.rotate_after_checkout, s.verify_enabled, s.password_changed_at, s.next_rotation_at,
  s.last_verified_at, s.last_verification_ok, s.last_rotation_error, s.last_used_at, s.created_at, s.updated_at
"""
FROM = "FROM public.pam_secrets s LEFT JOIN public.groups g ON g.id = s.owner_group_id"
REQUEST_COLUMNS = """
  r.id, r.secret_id, s.name AS secret_name, s.host AS secret_host, s.environment AS secret_environment,
  r.requester_id, rp.display_name AS requester_name, r.reason, r.ticket_reference, r.duration_minutes, r.status,
  r.approver_id, ap.display_name AS approver_name, r.decision_notes, r.decided_at, r.starts_at, r.expires_at,
  r.checked_in_at, r.reveal_count, r.created_at, r.updated_at
"""
REQUEST_FROM = """
  FROM public.pam_access_requests r
  JOIN public.pam_secrets s ON s.id = r.secret_id
  LEFT JOIN public.profiles rp ON rp.id = r.requester_id
  LEFT JOIN public.profiles ap ON ap.id = r.approver_id
"""
# camelCase field -> column for PATCH; the SET clause only uses these keys.
FIELDS = {
    "name": "name",
    "host": "host",
    "port": "port",
    "username": "username",
    "template": "template",
    "environment": "environment",
    "folder": "folder",
    "description": "description",
    "ownerGroupId": "owner_group_id",
    "approvalRequired": "approval_required",
    "maxCheckoutMinutes": "max_checkout_minutes",
    "rotationEnabled": "rotation_enabled",
    "rotationIntervalDays": "rotation_interval_days",
    "rotateAfterCheckout": "rotate_after_checkout",
    "verifyEnabled": "verify_enabled",
}
# Rotation enabled on a secret that was never rotated is due at once; otherwise one interval after the last change.
RESCHEDULE = (
    "UPDATE public.pam_secrets SET next_rotation_at = CASE WHEN rotation_enabled THEN "
    "coalesce(password_changed_at + make_interval(days => rotation_interval_days), now()) END "
    "WHERE organization_id = %s AND id = ANY(%s::uuid[])"
)


def with_risk(row: dict) -> dict:
    row["risk"], row["risk_reasons"] = vault.assess(row)
    return row


def is_custodian(org_id: str) -> bool:
    return bool(call_function("pam_is_custodian", [("_org_id", org_id, "uuid")]))


def require_custodian(org_id: str) -> None:
    # Checked in the database as the caller, not only by policy.
    if not is_custodian(org_id):
        raise PermissionDenied("Only workspace managers and administrators can manage privileged secrets.")


def load_secret(org_id: str, secret_id) -> dict:
    row = fetch_one(f"SELECT {COLUMNS} {FROM} WHERE s.organization_id = %s AND s.id = %s", [org_id, str(secret_id)])
    if not row:
        raise Http404
    return with_risk(row)


def load_request(org_id: str, request_id) -> dict:
    row = fetch_one(
        f"SELECT {REQUEST_COLUMNS} {REQUEST_FROM} WHERE r.organization_id = %s AND r.id = %s",
        [org_id, str(request_id)],
    )
    if not row:
        raise Http404
    return row


def group_in_org(org_id: str, group_id) -> bool:
    return bool(
        fetch_one("SELECT 1 AS ok FROM public.groups WHERE organization_id = %s AND id = %s", [org_id, str(group_id)])
    )


def summary(org_id: str, rows: list[dict]) -> dict:
    total = len(rows)
    now = timezone.now()
    sessions = fetch_one(
        "SELECT count(*) AS n FROM public.pam_events WHERE organization_id = %s AND action = 'revealed' "
        "AND created_at >= date_trunc('day', now())",
        [org_id],
    )["n"]
    return {
        "total": total,
        "automatic_rotation_pct": round(100 * sum(r["rotation_enabled"] for r in rows) / total) if total else 0,
        "used_never_rotated": sum(
            r["password_changed_at"] is None and bool(r["last_used_at"]) and r["last_used_at"] >= now - vault.RECENT_USE
            for r in rows
        ),
        "never_verified": sum(r["last_verified_at"] is None for r in rows),
        "sessions_today": sessions,
    }


class PamSecretListView(CallerAPIView):
    policy_actions = {"GET": "pam.read", "POST": "pam.manage"}

    def get(self, request, org_id):
        params = request.query_params
        rows = [
            with_risk(r)
            for r in fetch_all(f"SELECT {COLUMNS} {FROM} WHERE s.organization_id = %s ORDER BY s.name", [self.org_id])
        ]
        environment, risk = params.get("environment"), params.get("risk")
        if (environment and environment not in ENVIRONMENTS) or (risk and risk not in RISKS):
            return Response({"detail": "Unknown filter."}, status=400)

        filtered = rows
        if q := (params.get("q") or "").strip().lower():
            filtered = [
                r for r in filtered if any(q in (r[k] or "").lower() for k in ("name", "host", "folder", "username"))
            ]
        if folder := params.get("folder"):
            filtered = [r for r in filtered if r["folder"] == folder]
        if risk:
            filtered = [r for r in filtered if r["risk"] == risk]
        if params.get("usedNeverRotated") == "true":
            filtered = [r for r in filtered if r["risk_reasons"][:1] == ["Used in the last 7 days but never rotated."]]
        # Tab counts follow the other filters; the environment filter applies last.
        counts = Counter(r["environment"] for r in filtered)
        environment_counts = {"all": len(filtered), **{e: counts.get(e, 0) for e in ENVIRONMENTS}}
        if environment:
            filtered = [r for r in filtered if r["environment"] == environment]

        order = {level: i for i, level in enumerate(RISKS)}
        filtered.sort(key=lambda r: (order[r["risk"]], r["name"].lower()))
        groups = fetch_all(
            "SELECT id, name FROM public.groups WHERE organization_id = %s AND is_active ORDER BY name", [self.org_id]
        )
        return Response(
            {
                "results": filtered,
                "summary": summary(self.org_id, rows),
                "environment_counts": environment_counts,
                "folders": sorted({r["folder"] for r in rows}),
                "groups": groups,
                "is_custodian": is_custodian(self.org_id),
            }
        )

    def post(self, request, org_id):
        data = SecretCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        require_custodian(self.org_id)
        actor = request.user.user_id
        name = v["name"].strip()
        if fetch_one(
            "SELECT 1 AS ok FROM public.pam_secrets WHERE organization_id = %s AND name = %s", [self.org_id, name]
        ):
            return Response({"detail": "A secret with this name already exists."}, status=400)
        if v.get("ownerGroupId") and not group_in_org(self.org_id, v["ownerGroupId"]):
            return Response({"detail": "That group is not available in this workspace."}, status=400)
        secret_id = str(uuid.uuid4())
        execute(
            "INSERT INTO public.pam_secrets(id, organization_id, name, host, port, username, template, environment, "
            "folder, description, owner_group_id, approval_required, max_checkout_minutes, rotation_enabled, "
            "rotation_interval_days, rotate_after_checkout, verify_enabled, ciphertext, key_version, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [
                secret_id,
                self.org_id,
                name,
                v["host"].strip(),
                v["port"],
                v["username"].strip(),
                v["template"],
                v["environment"],
                v["folder"].strip() or "General",
                v["description"].strip(),
                str(v["ownerGroupId"]) if v.get("ownerGroupId") else None,
                v["approvalRequired"],
                v["maxCheckoutMinutes"],
                v["rotationEnabled"],
                v["rotationIntervalDays"],
                v["rotateAfterCheckout"],
                v["verifyEnabled"],
                crypto.encrypt(v["password"], self.org_id, secret_id),
                crypto.KEY_VERSION,
                actor,
            ],
        )
        execute(RESCHEDULE, [self.org_id, [secret_id]])
        with vault.service_role(actor):
            vault.log_event(self.org_id, "created", secret_id=secret_id, secret_name=name, actor_id=actor)
        return Response(load_secret(self.org_id, secret_id), status=status.HTTP_201_CREATED)


class PamSecretDetailView(CallerAPIView):
    policy_actions = {"GET": "pam.read", "PATCH": "pam.manage", "DELETE": "pam.manage"}

    def get(self, request, org_id, secret_id):
        secret = load_secret(self.org_id, secret_id)
        secret["events"] = fetch_all(
            "SELECT e.id, e.action, e.detail, e.created_at, e.actor_id, p.display_name AS actor_name "
            "FROM public.pam_events e LEFT JOIN public.profiles p ON p.id = e.actor_id "
            "WHERE e.organization_id = %s AND e.secret_id = %s ORDER BY e.id DESC LIMIT 50",
            [self.org_id, str(secret_id)],
        )
        # RLS shows the caller's own requests, or all of them to custodians.
        secret["requests"] = fetch_all(
            f"SELECT {REQUEST_COLUMNS} {REQUEST_FROM} WHERE r.organization_id = %s AND r.secret_id = %s "
            "ORDER BY r.created_at DESC LIMIT 20",
            [self.org_id, str(secret_id)],
        )
        secret["my_request"] = fetch_one(
            f"SELECT {REQUEST_COLUMNS} {REQUEST_FROM} WHERE r.organization_id = %s AND r.secret_id = %s "
            "AND r.requester_id = %s AND r.status IN ('pending', 'approved') "
            "AND (r.expires_at IS NULL OR r.expires_at > now())",
            [self.org_id, str(secret_id), request.user.user_id],
        )
        secret["is_custodian"] = is_custodian(self.org_id)
        return Response(secret)

    def patch(self, request, org_id, secret_id):
        data = SecretUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        require_custodian(self.org_id)
        actor = request.user.user_id
        current = fetch_one(
            "SELECT name, environment, approval_required, updated_at FROM public.pam_secrets "
            "WHERE organization_id = %s AND id = %s FOR UPDATE",
            [self.org_id, str(secret_id)],
        )
        if not current:
            raise Http404
        if current["updated_at"] != v["expectedUpdatedAt"]:
            raise Conflict(CONFLICT_MESSAGE)
        patch = {column: v[key] for key, column in FIELDS.items() if key in v}
        merged = {**current, **patch}
        if merged["environment"] == "production" and not merged["approval_required"]:
            raise ValidationError({"approvalRequired": PRODUCTION_APPROVAL})
        for column in ("name", "host", "username", "folder", "description"):
            if column in patch:
                patch[column] = patch[column].strip()
        if patch.get("owner_group_id"):
            if not group_in_org(self.org_id, patch["owner_group_id"]):
                return Response({"detail": "That group is not available in this workspace."}, status=400)
            patch["owner_group_id"] = str(patch["owner_group_id"])
        if (
            "name" in patch
            and patch["name"] != current["name"]
            and fetch_one(
                "SELECT 1 AS ok FROM public.pam_secrets WHERE organization_id = %s AND name = %s",
                [self.org_id, patch["name"]],
            )
        ):
            return Response({"detail": "A secret with this name already exists."}, status=400)
        if patch:
            assignments = ", ".join(f"{column} = %s" for column in patch)
            execute(
                f"UPDATE public.pam_secrets SET {assignments} WHERE organization_id = %s AND id = %s",
                [*patch.values(), self.org_id, str(secret_id)],
            )
            if {"rotation_enabled", "rotation_interval_days"} & patch.keys():
                execute(RESCHEDULE, [self.org_id, [str(secret_id)]])
            with vault.service_role(actor):
                vault.log_event(
                    self.org_id,
                    "updated",
                    secret_id=secret_id,
                    secret_name=patch.get("name", current["name"]),
                    actor_id=actor,
                    detail={"fields": sorted(patch)},
                )
        return Response(load_secret(self.org_id, secret_id))

    def delete(self, request, org_id, secret_id):
        require_custodian(self.org_id)
        actor = request.user.user_id
        secret = load_secret(self.org_id, secret_id)
        execute("DELETE FROM public.pam_secrets WHERE organization_id = %s AND id = %s", [self.org_id, str(secret_id)])
        with vault.service_role(actor):
            vault.log_event(self.org_id, "deleted", secret_id=secret_id, secret_name=secret["name"], actor_id=actor)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PamSecretPasswordView(CallerAPIView):
    """Replace the vault copy after the password was changed outside the vault."""

    policy_actions = {"POST": "pam.manage"}

    def post(self, request, org_id, secret_id):
        data = PasswordSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        require_custodian(self.org_id)
        actor = request.user.user_id
        secret = load_secret(self.org_id, secret_id)
        with vault.service_role(actor):
            vault.store_password({"id": secret["id"], "organization_id": self.org_id}, data.validated_data["password"])
            vault.log_event(
                self.org_id, "password_set", secret_id=secret_id, secret_name=secret["name"], actor_id=actor
            )
        return Response(load_secret(self.org_id, secret_id))


class PamSecretActionView(CallerAPIView):
    policy_actions = {"POST": "pam.manage"}
    operation = ""

    def post(self, request, org_id, secret_id):
        require_custodian(self.org_id)
        actor = request.user.user_id
        load_secret(self.org_id, secret_id)
        with vault.service_role(actor):
            if self.operation == "rotate":
                result = vault.rotate(secret_id, actor, "manual")
            else:
                result = vault.verify(secret_id, actor)
        return Response({**result, "secret": load_secret(self.org_id, secret_id)})


class PamBulkView(CallerAPIView):
    policy_actions = {"POST": "pam.manage"}

    def post(self, request, org_id):
        data = BulkSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        require_custodian(self.org_id)
        actor = request.user.user_id
        found = fetch_all(
            "SELECT id, name FROM public.pam_secrets WHERE organization_id = %s AND id = ANY(%s::uuid[]) ORDER BY name",
            [self.org_id, [str(i) for i in v["ids"]]],
        )
        if len(found) != len(set(v["ids"])):
            return Response({"detail": "Some selected secrets are not available in this workspace."}, status=400)
        ids = [str(r["id"]) for r in found]
        action = v["action"]
        results = []
        if action == "verify":
            with vault.service_role(actor):
                for row in found:
                    results.append({"id": row["id"], "name": row["name"], **vault.verify(row["id"], actor)})
        else:
            if action == "move":
                execute(
                    "UPDATE public.pam_secrets SET folder = %s WHERE organization_id = %s AND id = ANY(%s::uuid[])",
                    [v["folder"].strip(), self.org_id, ids],
                )
                fields = ["folder"]
            else:
                execute(
                    "UPDATE public.pam_secrets SET rotation_enabled = %s "
                    "WHERE organization_id = %s AND id = ANY(%s::uuid[])",
                    [action == "enable_rotation", self.org_id, ids],
                )
                execute(RESCHEDULE, [self.org_id, ids])
                fields = ["rotation_enabled"]
            with vault.service_role(actor):
                for row in found:
                    vault.log_event(
                        self.org_id,
                        "updated",
                        secret_id=row["id"],
                        secret_name=row["name"],
                        actor_id=actor,
                        detail={"fields": fields, "bulk": True},
                    )
            results = [{"id": row["id"], "name": row["name"], "ok": True} for row in found]
        return Response({"action": action, "results": results})


class PamRequestListView(CallerAPIView):
    policy_actions = {"GET": "pam.read", "POST": "pam.request"}

    def get(self, request, org_id):
        scope = request.query_params.get("scope", "mine")
        clauses, params = ["r.organization_id = %s"], [self.org_id]
        if scope == "mine":
            clauses.append("r.requester_id = %s")
            params.append(request.user.user_id)
        elif scope == "approvals":
            # RLS limits other people's requests to custodians.
            clauses.append("r.status = 'pending' AND r.requester_id <> %s")
            params.append(request.user.user_id)
        elif scope != "all":
            return Response({"detail": "Unknown scope."}, status=400)
        rows = fetch_all(
            f"SELECT {REQUEST_COLUMNS} {REQUEST_FROM} WHERE {' AND '.join(clauses)} "
            "ORDER BY (r.status IN ('pending', 'approved')) DESC, r.created_at DESC LIMIT 200",
            params,
        )
        now = timezone.now()
        for row in rows:
            # Shown as expired before the scheduled job closes it.
            if row["status"] == "approved" and row["expires_at"] and row["expires_at"] <= now:
                row["status"] = "expired"
        return Response({"results": rows, "is_custodian": is_custodian(self.org_id)})

    def post(self, request, org_id):
        data = AccessRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        actor = request.user.user_id
        secret = load_secret(self.org_id, v["secretId"])
        if v["durationMinutes"] > secret["max_checkout_minutes"]:
            raise ValidationError(
                {"durationMinutes": f"This secret allows at most {secret['max_checkout_minutes']} minutes."}
            )
        if fetch_one(
            "SELECT 1 AS ok FROM public.pam_access_requests WHERE secret_id = %s AND requester_id = %s "
            "AND status IN ('pending', 'approved') AND (expires_at IS NULL OR expires_at > now())",
            [str(secret["id"]), actor],
        ):
            return Response({"detail": "You already have an open request for this secret."}, status=400)
        request_id = str(uuid.uuid4())
        with vault.service_role(actor):
            # A lapsed approval the expiry job has not closed yet would block the new request.
            execute(
                "UPDATE public.pam_access_requests SET status = 'expired' WHERE secret_id = %s AND requester_id = %s "
                "AND status = 'approved' AND expires_at <= now()",
                [str(secret["id"]), actor],
            )
        execute(
            "INSERT INTO public.pam_access_requests(id, organization_id, secret_id, requester_id, reason, "
            "ticket_reference, duration_minutes) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            [
                request_id,
                self.org_id,
                str(secret["id"]),
                actor,
                v["reason"].strip(),
                (v.get("ticketReference") or "").strip() or None,
                v["durationMinutes"],
            ],
        )
        with vault.service_role(actor):
            vault.log_event(
                self.org_id,
                "access_requested",
                secret_id=secret["id"],
                secret_name=secret["name"],
                request_id=request_id,
                actor_id=actor,
                detail={"duration_minutes": v["durationMinutes"]},
            )
            if not secret["approval_required"]:
                approve(request_id, actor, AUTO_APPROVED)
                vault.log_event(
                    self.org_id,
                    "access_approved",
                    secret_id=secret["id"],
                    secret_name=secret["name"],
                    request_id=request_id,
                    actor_id=actor,
                    detail={"auto": True},
                )
        return Response(load_request(self.org_id, request_id), status=status.HTTP_201_CREATED)


def approve(request_id: str, approver_id: str, notes: str) -> None:
    """Start the access window now. Service role."""
    execute(
        "UPDATE public.pam_access_requests SET status = 'approved', approver_id = %s, decision_notes = %s, "
        "decided_at = now(), starts_at = now(), expires_at = now() + make_interval(mins => duration_minutes) "
        "WHERE id = %s AND status = 'pending'",
        [approver_id, notes, request_id],
    )


class PamRequestDecisionView(CallerAPIView):
    policy_actions = {"POST": "pam.decide"}

    def post(self, request, org_id, request_id):
        data = DecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        require_custodian(self.org_id)
        actor = request.user.user_id
        access = load_request(self.org_id, request_id)
        if str(access["requester_id"]) == actor:
            raise PermissionDenied("Another custodian must decide your own access request.")
        with vault.service_role(actor):
            locked = fetch_one(
                "SELECT status FROM public.pam_access_requests WHERE id = %s FOR UPDATE", [str(request_id)]
            )
            if locked["status"] != "pending":
                raise Conflict("This request was already decided. Refresh to see its status.")
            if v["decision"] == "approve":
                approve(str(request_id), actor, v["notes"].strip() or None)
            else:
                execute(
                    "UPDATE public.pam_access_requests SET status = 'rejected', approver_id = %s, "
                    "decision_notes = %s, decided_at = now() WHERE id = %s",
                    [actor, v["notes"].strip(), str(request_id)],
                )
            vault.log_event(
                self.org_id,
                "access_approved" if v["decision"] == "approve" else "access_rejected",
                secret_id=access["secret_id"],
                secret_name=access["secret_name"],
                request_id=request_id,
                actor_id=actor,
            )
        return Response(load_request(self.org_id, request_id))


def own_request(view: CallerAPIView, request_id) -> dict:
    access = load_request(view.org_id, request_id)
    if str(access["requester_id"]) != view.request.user.user_id:
        raise PermissionDenied("Only the person who requested access can use it.")
    return access


class PamRequestRevealView(CallerAPIView):
    policy_actions = {"POST": "pam.request"}

    def post(self, request, org_id, request_id):
        actor = request.user.user_id
        own_request(self, request_id)
        with vault.service_role(actor):
            access = fetch_one(
                "SELECT r.status, r.starts_at, r.expires_at, s.id AS secret_id, s.name, s.organization_id, "
                "s.ciphertext FROM public.pam_access_requests r JOIN public.pam_secrets s ON s.id = r.secret_id "
                "WHERE r.id = %s FOR UPDATE OF r",
                [str(request_id)],
            )
            now = timezone.now()
            if access["status"] != "approved" or not (access["starts_at"] <= now < access["expires_at"]):
                raise PermissionDenied("This request is not inside an approved access window.")
            password = crypto.decrypt(access["ciphertext"], access["organization_id"], access["secret_id"])
            execute(
                "UPDATE public.pam_access_requests SET reveal_count = reveal_count + 1 WHERE id = %s", [str(request_id)]
            )
            execute("UPDATE public.pam_secrets SET last_used_at = now() WHERE id = %s", [str(access["secret_id"])])
            vault.log_event(
                self.org_id,
                "revealed",
                secret_id=access["secret_id"],
                secret_name=access["name"],
                request_id=request_id,
                actor_id=actor,
            )
        response = Response({"password": password, "expires_at": access["expires_at"]})
        response["Cache-Control"] = "no-store"
        return response


class PamRequestCheckInView(CallerAPIView):
    """End access early. The requester or a custodian may check in; revealed passwords rotate if the secret asks."""

    policy_actions = {"POST": "pam.request"}

    def post(self, request, org_id, request_id):
        actor = request.user.user_id
        access = load_request(self.org_id, request_id)
        if str(access["requester_id"]) != actor:
            require_custodian(self.org_id)
        with vault.service_role(actor):
            row = fetch_one(
                "UPDATE public.pam_access_requests r SET status = 'checked_in', checked_in_at = now() "
                "FROM public.pam_secrets s WHERE s.id = r.secret_id AND r.id = %s AND r.status = 'approved' "
                "RETURNING r.reveal_count, s.rotate_after_checkout",
                [str(request_id)],
            )
            if not row:
                raise Conflict("Only active access can be checked in. Refresh to see its status.")
            vault.log_event(
                self.org_id,
                "checked_in",
                secret_id=access["secret_id"],
                secret_name=access["secret_name"],
                request_id=request_id,
                actor_id=actor,
            )
        if row["rotate_after_checkout"] and row["reveal_count"]:
            secret_id = str(access["secret_id"])
            transaction.on_commit(lambda: rotate_secret.delay(secret_id, actor, "checkin"))
        return Response(load_request(self.org_id, request_id))


class PamRequestCancelView(CallerAPIView):
    policy_actions = {"POST": "pam.request"}

    def post(self, request, org_id, request_id):
        actor = request.user.user_id
        access = own_request(self, request_id)
        with vault.service_role(actor):
            if not execute(
                "UPDATE public.pam_access_requests SET status = 'cancelled' WHERE id = %s AND status = 'pending'",
                [str(request_id)],
            ):
                raise Conflict("Only pending requests can be cancelled. Check in active access instead.")
            vault.log_event(
                self.org_id,
                "access_cancelled",
                secret_id=access["secret_id"],
                secret_name=access["secret_name"],
                request_id=request_id,
                actor_id=actor,
            )
        return Response(load_request(self.org_id, request_id))
