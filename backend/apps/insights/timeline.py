"""Port of src/lib/ticket-timeline.ts and the SLA helpers in src/lib/itsm-shared.ts / incident-workflow.ts.

Timelines are built only from immutable database audit snapshots (source = 'database'); a record's
last-update time is never used to invent when something happened. SLA lateness stops at the recorded
completion, cancellation or pause.
"""

from collections.abc import Iterable
from datetime import datetime
from typing import Any

STATE_LABELS = {
    "in_progress": "Work started",
    "pending": "On hold",
    "resolved": "Resolved",
    "closed": "Closed",
    "cancelled": "Cancelled",
    "new": "New",
}


def to_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _snapshot(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def ticket_timeline(ticket: dict, audit: Iterable[dict]) -> list[dict]:
    entries: list[dict] = [{"id": "opened", "label": "Opened", "at": to_datetime(ticket["created_at"])}]
    for event in audit:
        if event.get("source") != "database" or event.get("action") not in ("created", "updated"):
            continue
        before, after = _snapshot(event.get("before_values")), _snapshot(event.get("after_values"))
        when = to_datetime(event["created_at"])

        def add(suffix: str, label: str, *, _event=event, _when=when, **extra) -> None:
            entries.append(
                {
                    "id": f"{_event['id']}-{suffix}",
                    "label": label,
                    "at": _when,
                    "actorId": _event.get("actor_id"),
                    **extra,
                }
            )

        if after.get("assignee_id") != before.get("assignee_id") and (
            after.get("assignee_id") or before.get("assignee_id")
        ):
            if after.get("assignee_id"):
                label = "Reassigned" if before.get("assignee_id") else "Assigned"
            else:
                label = "Unassigned"
            assignee = after.get("assignee_id")
            add("assigned", label, personId=assignee if isinstance(assignee, str) else None)
        if after.get("group_id") != before.get("group_id") and (after.get("group_id") or before.get("group_id")):
            group = after.get("group_id")
            add(
                "team", "Routed to team" if group else "Team removed", groupId=group if isinstance(group, str) else None
            )
        if before.get("state") and after.get("state") != before.get("state"):
            new_state = str(after.get("state"))
            if new_state == "open":
                label = "Reopened" if str(before.get("state")) in ("resolved", "closed") else "Opened for work"
            else:
                label = STATE_LABELS.get(new_state, "Status changed")
            add("state", label)
    responded = to_datetime(ticket.get("first_responded_at"))
    if responded:
        entries.append({"id": "response", "label": "First response", "at": responded})
    resolved = to_datetime(ticket.get("resolved_at"))
    if resolved and not any(
        e["label"] == "Resolved" and e["at"] and abs((e["at"] - resolved).total_seconds()) < 1 for e in entries
    ):
        entries.append({"id": "resolved", "label": "Resolved", "at": resolved})
    return sorted(entries, key=lambda e: e["at"])


def ticket_sla_targets(ticket: dict, slas: list[dict]) -> list[dict]:
    """Legacy records with only a recorded deadline still show that target."""
    due = ticket.get("sla_due_at") or ticket.get("due_at")
    if slas or not due:
        return slas
    return [
        {
            "id": "record-target",
            "target_type": "resolution" if ticket.get("sla_due_at") else "fulfillment",
            "started_at": ticket["created_at"],
            "due_at": due,
            "completed_at": ticket.get("resolved_at"),
            "paused_at": None,
            "status": "running",
        }
    ]


def ticket_sla_details(sla: dict, timeline: list[dict], now: datetime, ticket: dict) -> dict:
    started = to_datetime(sla["started_at"])
    completion_label = "First response" if sla["target_type"] == "response" else "Resolved"
    completion = next((e for e in timeline if e["label"] == completion_label and e["at"] >= started), None)
    cancelled = next((e for e in timeline if e["label"] == "Cancelled" and e["at"] >= started), None)
    completed_at = completion["at"] if completion else to_datetime(sla.get("completed_at"))
    due = to_datetime(sla["due_at"])
    stopped = bool(completed_at) or bool(cancelled) or sla.get("status") == "cancelled"
    paused = not stopped and sla.get("status") == "paused"
    missing_end = not stopped and not paused and ticket.get("state") in ("resolved", "closed", "cancelled")
    paused_at = to_datetime(sla.get("paused_at"))
    if completed_at:
        end = completed_at
    elif cancelled:
        end = cancelled["at"]
    elif paused and paused_at:
        end = paused_at
    else:
        end = now
    overdue_ms = None if missing_end else max(0, int((end - due).total_seconds() * 1000))
    if cancelled or sla.get("status") == "cancelled":
        state = "Cancelled"
    elif missing_end:
        state = "Completion time unavailable"
    elif overdue_ms:
        state = "Breached · paused" if paused else "Breached"
    elif paused:
        state = "Paused"
    elif completed_at:
        state = "Met"
    else:
        state = "Running"
    return {
        "state": state,
        "overdueMs": overdue_ms,
        "completedAt": completed_at,
        "paused": paused,
        "stopped": stopped,
        "missingEnd": missing_end,
    }


def sla_state(due_at: Any, resolved_at: Any, now: datetime) -> str:
    """Port of slaState: none | breached | at_risk | on_track | completed | completed_late."""
    if not due_at:
        return "none"
    due = to_datetime(due_at)
    if due is None:
        return "none"
    if resolved_at:
        resolved = to_datetime(resolved_at)
        if resolved is None:
            return "none"
        return "completed" if resolved <= due else "completed_late"
    remaining_minutes = (due - now).total_seconds() / 60
    if remaining_minutes < 0:
        return "breached"
    if remaining_minutes <= 60:
        return "at_risk"
    return "on_track"


def incident_sla_attainment(rows: Iterable[dict]) -> float | None:
    """Resolutions without an SLA target belong on neither side of the ratio."""
    measured = [r for r in rows if r.get("resolved_at") and r.get("sla_due_at")]
    if not measured:
        return None
    met = [r for r in measured if to_datetime(r["resolved_at"]) <= to_datetime(r["sla_due_at"])]
    return len(met) / len(measured) * 100
