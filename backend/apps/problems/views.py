"""Problem management (legacy /problems). Reads are for workspace staff (RLS: can_manage); changes need the
legacy problem roles. Updates are versioned by expectedUpdatedAt, which the legacy app did not check, and a new
problem raised from an incident commits together with its link (legacy made separate requests)."""

import json
from datetime import UTC, datetime

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, execute, fetch_all, fetch_one
from apps.core.exceptions import Conflict
from apps.core.views import CallerAPIView

from .serializers import STATES, LinkSerializer, ProblemCreateSerializer, ProblemUpdateSerializer

CONFLICT_MESSAGE = "This problem changed after you opened it. Refresh and review the latest values before saving."
COLUMNS = """
  p.id, p.number, p.title, p.description, p.state::text AS state, p.impact, p.urgency, p.priority, p.category,
  p.service_id, s.name AS service_name, p.assignee_id, a.display_name AS assignee_name, p.known_error,
  p.workaround, p.root_cause, p.fix_plan, p.resolution_notes, p.knowledge_article_id,
  k.number AS knowledge_article_number, k.title AS knowledge_article_title, p.resolved_at, p.created_at,
  p.updated_at,
  (SELECT count(*) FROM public.problem_incidents pi WHERE pi.problem_id = p.id) AS incident_count
"""
FROM = """
  FROM public.problems p
  LEFT JOIN public.services s ON s.id = p.service_id
  LEFT JOIN public.profiles a ON a.id = p.assignee_id
  LEFT JOIN public.knowledge_articles k ON k.id = p.knowledge_article_id
"""
# Casts for columns build by ProblemDetailView.patch; the SET clause only uses these keys.
CASTS = {
    "state": "::public.record_state",
    "assignee_id": "::uuid",
    "knowledge_article_id": "::uuid",
    "impact": "::smallint",
    "urgency": "::smallint",
    "priority": "::smallint",
    "resolved_at": "::timestamptz",
    "known_error": "",
    "workaround": "",
    "root_cause": "",
    "fix_plan": "",
    "resolution_notes": "",
}


def priority(impact: int, urgency: int) -> int:
    return min(5, impact + urgency - 1)


def audit(org_id: str, actor_id: str, record_id, action: str, after: dict) -> None:
    # No RETURNING: writing an audit event does not imply being able to read the log back.
    execute(
        "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source, "
        "after_values) VALUES (%s, 'problem', %s, %s, %s, 'application', %s::jsonb)",
        [org_id, str(record_id), actor_id, action, json.dumps(after, default=str)],
    )


def load_problem(org_id: str, problem_id) -> dict:
    row = fetch_one(f"SELECT {COLUMNS} {FROM} WHERE p.organization_id = %s AND p.id = %s", [org_id, str(problem_id)])
    if not row:
        raise Http404
    row["incidents"] = fetch_all(
        "SELECT i.id, i.number, i.title, i.state::text AS state, i.priority, i.major_incident, "
        "pi.created_at AS linked_at FROM public.problem_incidents pi "
        "JOIN public.incidents i ON i.id = pi.incident_id WHERE pi.problem_id = %s ORDER BY pi.created_at",
        [str(problem_id)],
    )
    return row


def incident_in_org(org_id: str, incident_id) -> bool:
    return bool(
        fetch_one(
            "SELECT 1 AS ok FROM public.incidents WHERE organization_id = %s AND id = %s", [org_id, str(incident_id)]
        )
    )


def link_incident(org_id: str, problem_id: str, incident_id: str, actor: str) -> None:
    execute(
        "INSERT INTO public.problem_incidents(organization_id, problem_id, incident_id, linked_by) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT (problem_id, incident_id) DO NOTHING",
        [org_id, problem_id, incident_id, actor],
    )
    execute(
        "UPDATE public.incidents SET problem_id = %s WHERE organization_id = %s AND id = %s",
        [problem_id, org_id, incident_id],
    )


class ProblemListView(CallerAPIView):
    policy_actions = {"GET": "problem.read", "POST": "problem.run"}

    def get(self, request, org_id):
        clauses, params = ["p.organization_id = %s"], [self.org_id]
        state = request.query_params.get("state")
        if state:
            wanted = [s for s in state.split(",") if s in STATES]
            if not wanted:
                return Response({"detail": "Unknown state filter."}, status=400)
            clauses.append("p.state::text = ANY(%s)")
            params.append(wanted)
        if request.query_params.get("knownError") == "true":
            clauses.append("p.known_error")
        rows = fetch_all(
            f"SELECT {COLUMNS} {FROM} WHERE {' AND '.join(clauses)} ORDER BY p.priority NULLS LAST, p.created_at DESC",
            params,
        )
        services = fetch_all(
            "SELECT id, name FROM public.services WHERE organization_id = %s ORDER BY name", [self.org_id]
        )
        return Response({"results": rows, "services": services})

    def post(self, request, org_id):
        data = ProblemCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        actor = request.user.user_id
        if v.get("fromIncidentId") and not incident_in_org(self.org_id, v["fromIncidentId"]):
            return Response({"detail": "That incident is not available in this workspace."}, status=400)
        if v.get("serviceId") and not fetch_one(
            "SELECT 1 AS ok FROM public.services WHERE organization_id = %s AND id = %s",
            [self.org_id, str(v["serviceId"])],
        ):
            return Response({"detail": "That service is not available in this workspace."}, status=400)
        number = call_function("next_record_number", [("_org_id", self.org_id, "uuid"), ("_prefix", "PRB", "text")])
        problem = fetch_one(
            "INSERT INTO public.problems(organization_id, number, title, description, impact, urgency, priority, "
            "category, service_id, opened_by, assignee_id, state) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'new') RETURNING id, number",
            [
                self.org_id,
                number,
                v["title"].strip(),
                v["description"].strip(),
                v["impact"],
                v["urgency"],
                priority(v["impact"], v["urgency"]),
                (v.get("category") or "").strip() or None,
                str(v["serviceId"]) if v.get("serviceId") else None,
                actor,
                actor if v["assignToMe"] else None,
            ],
        )
        if v.get("fromIncidentId"):
            link_incident(self.org_id, str(problem["id"]), str(v["fromIncidentId"]), actor)
        audit(self.org_id, actor, problem["id"], "created", {"number": number})
        return Response(problem, status=status.HTTP_201_CREATED)


class ProblemDetailView(CallerAPIView):
    policy_actions = {"GET": "problem.read", "PATCH": "problem.run"}

    def get(self, request, org_id, problem_id):
        problem = load_problem(self.org_id, problem_id)
        linked = {str(i["id"]) for i in problem["incidents"]}
        problem["candidates"] = [
            i
            for i in fetch_all(
                "SELECT id, number, title, state::text AS state FROM public.incidents WHERE organization_id = %s "
                "AND state NOT IN ('closed', 'cancelled') ORDER BY created_at DESC LIMIT 200",
                [self.org_id],
            )
            if str(i["id"]) not in linked
        ]
        problem["articles"] = fetch_all(
            "SELECT id, number, title, status FROM public.knowledge_articles WHERE organization_id = %s "
            "AND status <> 'retired' ORDER BY updated_at DESC LIMIT 200",
            [self.org_id],
        )
        return Response(problem)

    def patch(self, request, org_id, problem_id):
        data = ProblemUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        actor = request.user.user_id
        current = fetch_one(
            "SELECT impact, urgency, root_cause, resolution_notes, updated_at FROM public.problems "
            "WHERE organization_id = %s AND id = %s",
            [self.org_id, str(problem_id)],
        )
        if not current:
            raise Http404
        if current["updated_at"] != v["expectedUpdatedAt"]:
            raise Conflict(CONFLICT_MESSAGE)

        patch: dict = {}
        if "state" in v:
            patch["state"] = v["state"]
        if v.get("assignToMe"):
            patch["assignee_id"] = actor
        if "knownError" in v:
            patch["known_error"] = v["knownError"]
        for key, column in (
            ("workaround", "workaround"),
            ("rootCause", "root_cause"),
            ("fixPlan", "fix_plan"),
            ("resolutionNotes", "resolution_notes"),
        ):
            if key in v:
                patch[column] = (v[key] or "").strip() or None
        if "impact" in v or "urgency" in v:
            patch["impact"] = v.get("impact", current["impact"])
            patch["urgency"] = v.get("urgency", current["urgency"])
            patch["priority"] = priority(patch["impact"], patch["urgency"])
        if "knowledgeArticleId" in v:
            article = str(v["knowledgeArticleId"]) if v["knowledgeArticleId"] else None
            if article and not fetch_one(
                "SELECT 1 AS ok FROM public.knowledge_articles WHERE organization_id = %s AND id = %s",
                [self.org_id, article],
            ):
                return Response({"detail": "That article is not available in this workspace."}, status=400)
            patch["knowledge_article_id"] = article
        if v.get("state") in ("resolved", "closed"):
            if not patch.get("root_cause", current["root_cause"]) or not patch.get(
                "resolution_notes", current["resolution_notes"]
            ):
                return Response(
                    {"detail": "Record the root cause and resolution notes before closing a problem."}, status=400
                )
            patch["resolved_at"] = datetime.now(UTC)
        elif "state" in v:
            patch["resolved_at"] = None

        if patch:
            columns = sorted(patch)
            assignments = ", ".join(f"{c} = %s{CASTS[c]}" for c in columns)
            if not execute(
                f"UPDATE public.problems SET {assignments} WHERE organization_id = %s AND id = %s AND updated_at = %s",
                [*(patch[c] for c in columns), self.org_id, str(problem_id), current["updated_at"]],
            ):
                raise Conflict(CONFLICT_MESSAGE)
            audit(self.org_id, actor, problem_id, "updated", patch)
        return Response(load_problem(self.org_id, problem_id))


class ProblemIncidentsView(CallerAPIView):
    policy_actions = {"POST": "problem.run"}

    def post(self, request, org_id, problem_id):
        data = LinkSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if not fetch_one(
            "SELECT 1 AS ok FROM public.problems WHERE organization_id = %s AND id = %s",
            [self.org_id, str(problem_id)],
        ):
            raise Http404
        if not incident_in_org(self.org_id, v["incidentId"]):
            return Response({"detail": "That incident is not available in this workspace."}, status=400)
        incident = str(v["incidentId"])
        if v["linked"]:
            link_incident(self.org_id, str(problem_id), incident, request.user.user_id)
        else:
            execute(
                "DELETE FROM public.problem_incidents WHERE problem_id = %s AND incident_id = %s",
                [str(problem_id), incident],
            )
            # Only clear the incident's pointer while it still points at this problem.
            execute(
                "UPDATE public.incidents SET problem_id = NULL "
                "WHERE organization_id = %s AND id = %s AND problem_id = %s",
                [self.org_id, incident, str(problem_id)],
            )
        audit(
            self.org_id,
            request.user.user_id,
            problem_id,
            "incident_linked" if v["linked"] else "incident_unlinked",
            {"incidentId": incident},
        )
        return Response(load_problem(self.org_id, problem_id))
