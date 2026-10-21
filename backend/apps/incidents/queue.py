"""Incident work queues (port of src/lib/incident-queue.ts and incident-queue.server.ts).

Queues decide which incidents are in scope; secondary filters (priority, group, service, search) narrow the
list but never change the queue totals.
"""

from datetime import UTC, datetime, timedelta

from rest_framework import serializers

from apps.core.db import fetch_all, fetch_one, like_pattern

QUEUES = ["active", "mine", "unassigned", "at_risk", "breached", "completed", "all"]
ACTIVE_STATES = ["new", "open", "in_progress", "pending"]
PAGE_SIZE = 25
ORDER_BY = {
    "sla": "i.sla_due_at ASC NULLS LAST, i.priority, i.created_at DESC, i.id",
    "priority": "i.priority, i.sla_due_at ASC NULLS LAST, i.created_at DESC, i.id",
    "newest": "i.created_at DESC, i.id",
    "oldest": "i.created_at ASC, i.id",
}


class QueueFilterSerializer(serializers.Serializer):
    queue = serializers.ChoiceField(choices=QUEUES, default="active")
    q = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    priority = serializers.ChoiceField(choices=["all", "1", "2", "3", "4", "5"], default="all")
    group = serializers.CharField(required=False, default="all")
    service = serializers.CharField(required=False, default="all")
    sort = serializers.ChoiceField(choices=list(ORDER_BY), default="sla")
    page = serializers.IntegerField(min_value=1, max_value=10000, default=1)

    def validate_group(self, value):
        if value not in ("all", "unassigned"):
            serializers.UUIDField().to_internal_value(value)
        return value

    def validate_service(self, value):
        if value != "all":
            serializers.UUIDField().to_internal_value(value)
        return value


def queue_clauses(queue: str, user_id: str, now: datetime) -> tuple[list[str], list]:
    clauses: list[str] = []
    params: list = []
    if queue not in ("all", "completed"):
        clauses.append("i.state::text = ANY(%s)")
        params.append(ACTIVE_STATES)
    if queue == "mine":
        clauses.append("i.assignee_id = %s")
        params.append(user_id)
    elif queue == "unassigned":
        clauses.append("i.assignee_id IS NULL")
    elif queue == "completed":
        clauses.append("i.state::text = ANY(%s)")
        params.append(["resolved", "closed"])
    elif queue == "breached":
        clauses.append("i.sla_due_at < %s")
        params.append(now)
    elif queue == "at_risk":
        clauses.append("i.sla_due_at BETWEEN %s AND %s")
        params += [now, now + timedelta(hours=1)]
    return clauses, params


def load_queue(org_id: str, user_id: str, filters: dict, columns: str) -> dict:
    now = datetime.now(UTC)
    clauses, params = queue_clauses(filters["queue"], user_id, now)
    clauses.insert(0, "i.organization_id = %s")
    params.insert(0, org_id)
    query = " ".join(filters["q"].replace("%", " ").replace("_", " ").split())
    if query:
        clauses.append("(i.number ILIKE %s OR i.title ILIKE %s)")
        params += [like_pattern(query)] * 2
    if filters["priority"] != "all":
        clauses.append("i.priority = %s")
        params.append(int(filters["priority"]))
    if filters["group"] == "unassigned":
        clauses.append("i.group_id IS NULL")
    elif filters["group"] != "all":
        clauses.append("i.group_id = %s")
        params.append(filters["group"])
    if filters["service"] != "all":
        clauses.append("i.service_id = %s")
        params.append(filters["service"])
    where = " AND ".join(clauses)
    total = fetch_one(f"SELECT count(*) AS n FROM public.incidents i WHERE {where}", params)["n"]
    rows = fetch_all(
        f"SELECT {columns}, g.name AS group_name, a.display_name AS assignee_name, s.name AS service_name "
        "FROM public.incidents i LEFT JOIN public.groups g ON g.id = i.group_id "
        "LEFT JOIN public.profiles a ON a.id = i.assignee_id LEFT JOIN public.services s ON s.id = i.service_id "
        f"WHERE {where} ORDER BY {ORDER_BY[filters['sort']]} LIMIT %s OFFSET %s",
        [*params, PAGE_SIZE, (filters["page"] - 1) * PAGE_SIZE],
    )
    return {"results": rows, "total": total, "page": filters["page"], "page_size": PAGE_SIZE, "fetched_at": now}


def queue_counts(org_id: str, user_id: str) -> dict:
    now = datetime.now(UTC)
    counts = {}
    for queue in QUEUES:
        clauses, params = queue_clauses(queue, user_id, now)
        where = " AND ".join(["i.organization_id = %s", *clauses])
        counts[queue] = fetch_one(f"SELECT count(*) AS n FROM public.incidents i WHERE {where}", [org_id, *params])["n"]
    return counts
