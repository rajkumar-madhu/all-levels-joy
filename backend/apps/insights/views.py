"""SLA performance, incident insights, record activity timelines and global search.

Every query runs as the caller, so row-level security decides what each person counts and sees: requesters
get their own tickets, staff the workspace.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta

from django.http import Http404
from rest_framework.response import Response

from apps.core.db import fetch_all, fetch_one, like_pattern
from apps.core.views import CallerAPIView

from .timeline import (
    incident_sla_attainment,
    sla_state,
    ticket_sla_details,
    ticket_sla_targets,
    ticket_timeline,
)

ACTIVE_STATES = ["new", "open", "in_progress", "pending"]
DAY = timedelta(days=1)
AUDIT_PAGE = 500


class SlaView(CallerAPIView):
    """Port of the legacy SLA dashboard: deadline health per team for open requests and incidents."""

    policy_actions = {"GET": "sla.read"}

    def get(self, request, org_id):
        now = datetime.now(UTC)
        groups = {
            str(g["id"]): g["name"]
            for g in fetch_all("SELECT id, name FROM public.groups WHERE organization_id = %s", [self.org_id])
        }
        requests_ = fetch_all(
            "SELECT id, number, title, state::text AS state, priority, due_at, group_id FROM public.service_requests "
            "WHERE organization_id = %s AND state::text = ANY(%s)",
            [self.org_id, ACTIVE_STATES],
        )
        incidents = fetch_all(
            "SELECT id, number, title, state::text AS state, priority, sla_due_at, resolved_at, group_id "
            "FROM public.incidents WHERE organization_id = %s AND state::text = ANY(%s)",
            [self.org_id, ACTIVE_STATES],
        )
        rows: dict[str, dict] = {}

        def row_for(group_id) -> dict:
            key = str(group_id) if group_id else "none"
            if key not in rows:
                rows[key] = {
                    "groupId": str(group_id) if group_id else None,
                    "team": groups.get(key, "Unassigned team"),
                    "openRequests": 0,
                    "openIncidents": 0,
                    "dueSoon": 0,
                    "breached": 0,
                }
            return rows[key]

        breached = []
        for r in requests_:
            row = row_for(r["group_id"])
            row["openRequests"] += 1
            due = r["due_at"]
            if due is not None:
                if due < now:
                    row["breached"] += 1
                    breached.append(("request", r, due))
                elif due - now <= DAY:
                    row["dueSoon"] += 1
        for i in incidents:
            row = row_for(i["group_id"])
            row["openIncidents"] += 1
            if sla_state(i["sla_due_at"], i["resolved_at"], now) == "breached":
                row["breached"] += 1
                breached.append(("incident", i, i["sla_due_at"]))
            elif i["sla_due_at"] and i["sla_due_at"] >= now and i["sla_due_at"] - now <= DAY:
                row["dueSoon"] += 1

        teams = sorted(rows.values(), key=lambda t: (-t["breached"], -t["dueSoon"], t["team"]))
        tickets = [
            {
                "recordType": kind,
                "id": t["id"],
                "number": t["number"],
                "title": t["title"],
                "state": t["state"],
                "priority": t["priority"],
                "dueAt": due,
                "team": groups.get(str(t["group_id"]), "Unassigned team") if t["group_id"] else "Unassigned team",
            }
            for kind, t, due in sorted(breached, key=lambda item: item[2])
        ]
        return Response({"teams": teams, "breached": tickets})


def _tally(rows: list[dict], key: str) -> list[dict]:
    counts = Counter((row.get(key) or "unspecified") for row in rows)
    return [{"label": label, "count": count} for label, count in sorted(counts.items(), key=lambda kv: -kv[1])]


def _average_hours(deltas: list[timedelta]) -> float | None:
    return sum(d.total_seconds() for d in deltas) / len(deltas) / 3600 if deltas else None


class IncidentMetricsView(CallerAPIView):
    """Port of getIncidentMetrics: 30-day volumes, MTTR, response time, SLA attainment and the open backlog."""

    policy_actions = {"GET": "insights.read"}
    WINDOW_DAYS = 30
    RECENT_LIMIT = 1000

    def get(self, request, org_id):
        now = datetime.now(UTC)
        recent = fetch_all(
            "SELECT id, number, title, state::text AS state, priority, category, contact_type, close_code, "
            "reopen_count, service_id, created_at, resolved_at, first_responded_at, sla_due_at "
            "FROM public.incidents WHERE organization_id = %s AND created_at >= %s "
            "ORDER BY created_at DESC LIMIT %s",
            [self.org_id, now - timedelta(days=self.WINDOW_DAYS), self.RECENT_LIMIT],
        )
        open_rows = fetch_all(
            "SELECT id, number, title, state::text AS state, priority, service_id, created_at, sla_due_at, "
            "assignee_id FROM public.incidents WHERE organization_id = %s AND state::text = ANY(%s) "
            "ORDER BY priority NULLS LAST LIMIT 500",
            [self.org_id, ACTIVE_STATES],
        )
        services = {
            str(s["id"]): s["name"]
            for s in fetch_all("SELECT id, name FROM public.services WHERE organization_id = %s", [self.org_id])
        }
        resolved = [r for r in recent if r["resolved_at"]]
        days = []
        for index in range(13, -1, -1):
            day = (now - index * DAY).date()
            days.append(
                {
                    "day": day.isoformat(),
                    "opened": sum(1 for r in recent if r["created_at"].astimezone(UTC).date() == day),
                    "resolved": sum(1 for r in resolved if r["resolved_at"].astimezone(UTC).date() == day),
                }
            )

        def service_name(service_id) -> str:
            return services.get(str(service_id), "Unknown") if service_id else "Unassigned"

        service_load = Counter(service_name(r["service_id"]) for r in open_rows)
        state_counts = Counter(r["state"] for r in open_rows)
        return Response(
            {
                "windowDays": self.WINDOW_DAYS,
                "sampledRecent": len(recent) == self.RECENT_LIMIT,
                "opened": len(recent),
                "resolved": len(resolved),
                "openTotal": len(open_rows),
                "unassigned": sum(1 for r in open_rows if not r["assignee_id"]),
                "reopened": sum(1 for r in recent if (r["reopen_count"] or 0) > 0),
                "mttrHours": _average_hours([r["resolved_at"] - r["created_at"] for r in resolved]),
                "responseHours": _average_hours(
                    [r["first_responded_at"] - r["created_at"] for r in recent if r["first_responded_at"]]
                ),
                "slaAttainment": incident_sla_attainment(resolved),
                "byPriority": [
                    {"priority": p, "open": sum(1 for r in open_rows if (r["priority"] or 5) == p)} for p in range(1, 6)
                ],
                "byState": [{"state": s, "count": c} for s, c in state_counts.items()],
                "byCategory": _tally(recent, "category"),
                "byContactType": _tally(recent, "contact_type"),
                "byCloseCode": _tally(resolved, "close_code"),
                "serviceLoad": [{"label": label, "count": count} for label, count in service_load.most_common(6)],
                "days": days,
                "ageing": [
                    {
                        "id": r["id"],
                        "number": r["number"],
                        "title": r["title"],
                        "priority": r["priority"],
                        "state": r["state"],
                        "createdAt": r["created_at"],
                        "slaDueAt": r["sla_due_at"],
                        "service": services.get(str(r["service_id"])) if r["service_id"] else None,
                        "ageDays": (now - r["created_at"]).days,
                    }
                    for r in sorted(open_rows, key=lambda r: r["created_at"])[:8]
                ],
            }
        )


TICKETS = {
    "incident": (
        "SELECT created_at, state::text AS state, resolved_at, first_responded_at, assignee_id, sla_due_at "
        "FROM public.incidents WHERE organization_id = %s AND id = %s"
    ),
    "request": (
        "SELECT created_at, state::text AS state, NULL::timestamptz AS resolved_at, "
        "NULL::timestamptz AS first_responded_at, assignee_id, due_at FROM public.service_requests "
        "WHERE organization_id = %s AND id = %s"
    ),
}


class ActivityView(CallerAPIView):
    """Response timeline and SLA targets for one incident or request (legacy getRecordActivity)."""

    policy_actions = {"GET": "activity.read"}

    def get(self, request, org_id, record_type, record_id):
        ticket = fetch_one(TICKETS[record_type], [self.org_id, str(record_id)])
        if not ticket:
            raise Http404
        # Every audit snapshot, page by page; RLS returns none to requesters, who see only recorded times.
        audit: list[dict] = []
        offset = 0
        while True:
            page = fetch_all(
                "SELECT id, action, source, created_at, actor_id, before_values, after_values "
                "FROM public.audit_events WHERE organization_id = %s AND record_type = %s AND record_id = %s "
                "ORDER BY created_at DESC, id LIMIT %s OFFSET %s",
                [self.org_id, record_type, str(record_id), AUDIT_PAGE, offset],
            )
            audit.extend(page)
            if len(page) < AUDIT_PAGE:
                break
            offset += AUDIT_PAGE
        slas = fetch_all(
            "SELECT id, target_type, started_at, due_at, completed_at, paused_at, status FROM public.sla_instances "
            "WHERE organization_id = %s AND record_type = %s AND record_id = %s ORDER BY started_at",
            [self.org_id, record_type, str(record_id)],
        )
        timeline = ticket_timeline(ticket, audit)
        now = datetime.now(UTC)
        targets = [
            {**sla, "id": str(sla["id"]), **ticket_sla_details(sla, timeline, now, ticket)}
            for sla in ticket_sla_targets(ticket, slas)
        ]
        people = {e.get("personId") for e in timeline} | {e.get("actorId") for e in timeline}
        groups = {e.get("groupId") for e in timeline}
        names = {
            str(p["id"]): p["display_name"]
            for p in fetch_all(
                "SELECT id, display_name FROM public.profiles WHERE id = ANY(%s::uuid[])",
                [[str(p) for p in people if p]],
            )
        }
        group_names = {
            str(g["id"]): g["name"]
            for g in fetch_all(
                "SELECT id, name FROM public.groups WHERE id = ANY(%s::uuid[])", [[str(g) for g in groups if g]]
            )
        }
        entries = [
            {
                **entry,
                "actorName": names.get(str(entry.get("actorId"))) if entry.get("actorId") else None,
                "personName": names.get(str(entry.get("personId"))) if entry.get("personId") else None,
                "groupName": group_names.get(str(entry.get("groupId"))) if entry.get("groupId") else None,
            }
            for entry in timeline
        ]
        return Response({"timeline": entries, "slas": targets})


class SearchView(CallerAPIView):
    """Port of searchRecords; each section only contains rows the caller may read."""

    policy_actions = {"GET": "search.read"}

    def get(self, request, org_id):
        query = (request.query_params.get("q") or "").strip()
        if not 2 <= len(query) <= 80:
            return Response({"detail": "Search for 2 to 80 characters."}, status=400)
        term = like_pattern(query)
        org = self.org_id
        tag = query.lower() if query.replace("-", "").isalnum() else None

        def run(sql: str, params: list) -> list[dict]:
            return fetch_all(sql + " LIMIT 5", params)

        return Response(
            {
                "incidents": run(
                    "SELECT id, number, title, state::text AS state, priority FROM public.incidents "
                    "WHERE organization_id = %s AND (number ILIKE %s OR title ILIKE %s) ORDER BY created_at DESC",
                    [org, term, term],
                ),
                "requests": run(
                    "SELECT id, number, title, state::text AS state FROM public.service_requests "
                    "WHERE organization_id = %s AND (number ILIKE %s OR title ILIKE %s) ORDER BY created_at DESC",
                    [org, term, term],
                ),
                "changes": run(
                    "SELECT id, number, title, state::text AS state FROM public.changes "
                    "WHERE organization_id = %s AND (number ILIKE %s OR title ILIKE %s) ORDER BY created_at DESC",
                    [org, term, term],
                ),
                "knowledge": run(
                    "SELECT id, number, title, status FROM public.knowledge_articles WHERE organization_id = %s "
                    "AND (number ILIKE %s OR title ILIKE %s OR summary ILIKE %s OR category ILIKE %s "
                    "OR content ILIKE %s OR (%s::text IS NOT NULL AND %s::text = ANY(tags))) ORDER BY created_at DESC",
                    [org, term, term, term, term, term, tag, tag],
                ),
                "assets": run(
                    "SELECT id, name FROM public.configuration_items WHERE organization_id = %s AND name ILIKE %s "
                    "ORDER BY name",
                    [org, term],
                ),
                "catalog": run(
                    "SELECT id, name, category FROM public.catalog_items WHERE organization_id = %s AND active "
                    "AND (name ILIKE %s OR category ILIKE %s OR description ILIKE %s) ORDER BY name",
                    [org, term, term, term],
                ),
                "security": run(
                    "SELECT id, number, title, state, severity FROM public.security_findings "
                    "WHERE organization_id = %s AND (number ILIKE %s OR title ILIKE %s OR reference ILIKE %s) "
                    "ORDER BY created_at DESC",
                    [org, term, term, term],
                ),
            }
        )
