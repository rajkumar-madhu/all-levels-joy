"""Major incident command (legacy /command-center). Each request is one transaction, so declaring a
bridge and flagging its incident happen together or not at all (the legacy server function could leave a
bridge behind when the incident flag failed)."""

import json
from datetime import UTC, datetime, timedelta

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, execute, fetch_all, fetch_one
from apps.core.exceptions import Conflict
from apps.core.views import CallerAPIView

from .serializers import DeclareSerializer, PostUpdateSerializer, UpdateSerializer

ACTIVE_INCIDENT_STATES = ("new", "open", "in_progress", "pending")


def audit(org_id: str, actor_id: str, record_id, action: str, after: dict) -> None:
    # No RETURNING: the caller may write audit events without being able to read them back.
    execute(
        "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source, "
        "after_values) VALUES (%s, 'major_incident', %s, %s, %s, 'application', %s::jsonb)",
        [org_id, str(record_id), actor_id, action, json.dumps(after, default=str)],
    )


def minutes_from_now(minutes: int) -> datetime:
    return datetime.now(UTC) + timedelta(minutes=minutes)


class CommandCenterView(CallerAPIView):
    policy_actions = {"GET": "major_incident.read"}

    def get(self, request, org_id):
        org = [self.org_id]
        majors = fetch_all(
            """
            SELECT m.id, m.number, m.incident_id, m.problem_id, m.severity, m.bridge_state, m.commander_id,
                   m.comms_lead_id, m.bridge_url, m.situation_summary, m.customer_impact, m.escalation_level,
                   m.declared_at, m.mitigated_at, m.resolved_at, m.next_update_at,
                   i.number AS incident_number, i.title AS incident_title, i.state::text AS incident_state,
                   p.number AS problem_number, cmd.display_name AS commander_name, com.display_name AS comms_lead_name
            FROM public.major_incidents m
            JOIN public.incidents i ON i.id = m.incident_id
            LEFT JOIN public.problems p ON p.id = m.problem_id
            LEFT JOIN public.profiles cmd ON cmd.id = m.commander_id
            LEFT JOIN public.profiles com ON com.id = m.comms_lead_id
            WHERE m.organization_id = %s ORDER BY m.declared_at DESC
            """,
            org,
        )
        updates = fetch_all(
            "SELECT u.id, u.major_incident_id, u.author_id, a.display_name AS author_name, u.update_type, u.body, "
            "u.audience, u.created_at FROM public.major_incident_updates u "
            "LEFT JOIN public.profiles a ON a.id = u.author_id "
            "WHERE u.organization_id = %s ORDER BY u.created_at DESC LIMIT 300",
            org,
        )
        candidates = fetch_all(
            "SELECT i.id, i.number, i.title, i.priority FROM public.incidents i "
            "WHERE i.organization_id = %s AND i.state::text = ANY(%s) "
            "AND NOT EXISTS (SELECT 1 FROM public.major_incidents m WHERE m.incident_id = i.id) "
            "ORDER BY i.priority NULLS LAST, i.created_at DESC LIMIT 40",
            [self.org_id, list(ACTIVE_INCIDENT_STATES)],
        )
        problems = fetch_all(
            "SELECT id, number, title, state::text AS state FROM public.problems WHERE organization_id = %s "
            "ORDER BY created_at DESC LIMIT 200",
            org,
        )
        return Response({"majors": majors, "updates": updates, "candidates": candidates, "problems": problems})


class DeclareView(CallerAPIView):
    policy_actions = {"POST": "major_incident.run"}

    def post(self, request, org_id):
        data = DeclareSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        actor = request.user.user_id
        incident = fetch_one(
            "SELECT id, state::text AS state, updated_at FROM public.incidents WHERE organization_id = %s AND id = %s",
            [self.org_id, str(v["incidentId"])],
        )
        if not incident:
            return Response({"detail": "The linked incident was not found."}, status=400)
        if incident["state"] not in ACTIVE_INCIDENT_STATES:
            return Response({"detail": "Reopen the incident before declaring a major incident."}, status=400)
        existing = fetch_one("SELECT number FROM public.major_incidents WHERE incident_id = %s", [incident["id"]])
        if existing:
            return Response(
                {"detail": f"This incident is already under major incident command ({existing['number']})."},
                status=400,
            )
        number = call_function("next_record_number", [("_org_id", self.org_id, "uuid"), ("_prefix", "MI", "text")])
        severity = v["severity"]
        major = fetch_one(
            "INSERT INTO public.major_incidents(organization_id, number, incident_id, severity, bridge_state, "
            "commander_id, bridge_url, situation_summary, customer_impact, escalation_level, declared_by, "
            "next_update_at) VALUES (%s, %s, %s, %s, 'declared', %s, %s, %s, %s, %s, %s, %s) RETURNING id, number",
            [
                self.org_id,
                number,
                incident["id"],
                severity,
                actor if v["takeCommand"] else None,
                v.get("bridgeUrl") or None,
                v["situationSummary"].strip(),
                (v.get("customerImpact") or "").strip() or None,
                {1: 3, 2: 2}.get(severity, 1),
                actor,
                minutes_from_now(v["nextUpdateMinutes"]),
            ],
        )
        execute(
            "INSERT INTO public.major_incident_updates(organization_id, major_incident_id, author_id, update_type, "
            "audience, body) VALUES (%s, %s, %s, 'declaration', 'internal', %s)",
            [self.org_id, major["id"], actor, v["situationSummary"].strip()],
        )
        # The bridge has its own severity; only the flag changes on the incident, guarded by its version so
        # concurrent triage is never overwritten. If it changed, the whole declaration rolls back.
        if not execute(
            "UPDATE public.incidents SET major_incident = true "
            "WHERE organization_id = %s AND id = %s AND updated_at = %s",
            [self.org_id, incident["id"], incident["updated_at"]],
        ):
            raise Conflict("The incident changed while you were declaring. Refresh and declare again.")
        audit(self.org_id, actor, major["id"], "declared", {"number": number, "severity": severity})
        # Responders are notified in the same transaction; the database picks recipients and text.
        call_function("itsm_notify_major_incident_declared", [("_major_incident_id", str(major["id"]), "uuid")])
        return Response(major, status=status.HTTP_201_CREATED)


class MajorIncidentView(CallerAPIView):
    policy_actions = {"PATCH": "major_incident.run"}

    def patch(self, request, org_id, major_id):
        data = UpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        actor = request.user.user_id
        current = fetch_one(
            "SELECT id, incident_id, problem_id FROM public.major_incidents WHERE organization_id = %s AND id = %s",
            [self.org_id, str(major_id)],
        )
        if not current:
            raise Http404
        patch: dict = {}
        for key, column in (
            ("bridgeState", "bridge_state"),
            ("escalationLevel", "escalation_level"),
            ("severity", "severity"),
        ):
            if key in v:
                patch[column] = v[key]
        for key, column in (
            ("situationSummary", "situation_summary"),
            ("customerImpact", "customer_impact"),
            ("bridgeUrl", "bridge_url"),
        ):
            if key in v:
                patch[column] = (v[key] or "").strip() or None
        if v.get("takeCommand"):
            patch["commander_id"] = actor
        if v.get("takeComms"):
            patch["comms_lead_id"] = actor
        if "problemId" in v:
            patch["problem_id"] = str(v["problemId"]) if v["problemId"] else None
            if patch["problem_id"] and not fetch_one(
                "SELECT 1 AS ok FROM public.problems WHERE organization_id = %s AND id = %s",
                [self.org_id, patch["problem_id"]],
            ):
                return Response({"detail": "That problem is not available in this workspace."}, status=400)
        if v.get("nextUpdateMinutes"):
            patch["next_update_at"] = minutes_from_now(v["nextUpdateMinutes"])
        if v.get("bridgeState") == "mitigating":
            patch["mitigated_at"] = datetime.now(UTC)
        if v.get("bridgeState") == "resolved":
            patch["resolved_at"] = datetime.now(UTC)
            patch["next_update_at"] = None
        if patch:
            columns = sorted(patch)
            execute(
                f"UPDATE public.major_incidents SET {', '.join(f'{c} = %s' for c in columns)} "
                "WHERE organization_id = %s AND id = %s",
                [*(patch[c] for c in columns), self.org_id, current["id"]],
            )
            if "problem_id" in patch:
                self.relink_problem(current, patch["problem_id"], actor)
            audit(self.org_id, actor, current["id"], "updated", patch)
        # Resolving the bridge does not resolve the incident; that needs the incident's own resolution evidence.
        return Response({"ok": True})

    def relink_problem(self, current: dict, problem_id: str | None, actor: str) -> None:
        execute(
            "UPDATE public.incidents SET problem_id = %s, major_incident = true WHERE organization_id = %s AND id = %s",
            [problem_id, self.org_id, current["incident_id"]],
        )
        if current["problem_id"] and str(current["problem_id"]) != problem_id:
            execute(
                "DELETE FROM public.problem_incidents WHERE problem_id = %s AND incident_id = %s",
                [current["problem_id"], current["incident_id"]],
            )
        if problem_id:
            execute(
                "INSERT INTO public.problem_incidents(organization_id, problem_id, incident_id, linked_by) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (problem_id, incident_id) DO NOTHING",
                [self.org_id, problem_id, current["incident_id"], actor],
            )


class PostUpdateView(CallerAPIView):
    policy_actions = {"POST": "major_incident.run"}

    def post(self, request, org_id, major_id):
        data = PostUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if not fetch_one(
            "SELECT 1 AS ok FROM public.major_incidents WHERE organization_id = %s AND id = %s",
            [self.org_id, str(major_id)],
        ):
            raise Http404
        execute(
            "INSERT INTO public.major_incident_updates(organization_id, major_incident_id, author_id, update_type, "
            "audience, body) VALUES (%s, %s, %s, %s, %s, %s)",
            [self.org_id, str(major_id), request.user.user_id, v["updateType"], v["audience"], v["body"].strip()],
        )
        if v.get("nextUpdateMinutes"):
            execute(
                "UPDATE public.major_incidents SET next_update_at = %s WHERE organization_id = %s AND id = %s",
                [minutes_from_now(v["nextUpdateMinutes"]), self.org_id, str(major_id)],
            )
        audit(self.org_id, request.user.user_id, major_id, "update_posted", {"audience": v["audience"]})
        return Response({"ok": True}, status=status.HTTP_201_CREATED)
