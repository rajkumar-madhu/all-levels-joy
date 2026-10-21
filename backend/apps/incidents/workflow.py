"""Port of buildIncidentWorkflowPatch (src/lib/incident-workflow.ts).

The validate_incident_workflow trigger enforces the same rules in the database; this layer only turns
them into clear messages and builds the column patch.
"""

from datetime import datetime

TRANSITIONS: dict[str, tuple[str, ...]] = {
    "new": ("open", "in_progress", "pending", "resolved", "cancelled"),
    "open": ("in_progress", "pending", "resolved", "cancelled"),
    "in_progress": ("open", "pending", "resolved", "cancelled"),
    "pending": ("open", "in_progress", "resolved", "cancelled"),
    "resolved": ("closed", "open"),
    "closed": ("open",),
    "cancelled": (),
}
HOLD_REASONS = {"awaiting_caller", "awaiting_vendor", "awaiting_change", "awaiting_problem"}
CLOSE_CODES = {"solved_permanently", "solved_workaround", "solved_remotely", "not_solved", "duplicate"}
CONFLICT_MESSAGE = (
    "This incident changed after you opened it. Refresh the incident and review the latest values before saving."
)
UNSET = object()


class WorkflowError(Exception):
    pass


class Conflict(WorkflowError):
    pass


def _clean(value):
    return value.strip() or None if isinstance(value, str) else value


def build_patch(current: dict, data: dict, actor_id: str, now: datetime) -> dict:
    """`data` holds only the fields the caller sent (camelCase, as validated)."""
    if current["updated_at"] != data["expectedUpdatedAt"]:
        raise Conflict(CONFLICT_MESSAGE)
    next_state = data.get("state", current["state"])
    changing_state = next_state != current["state"]
    if changing_state and next_state not in TRANSITIONS[current["state"]]:
        raise WorkflowError(f"Incident cannot move from {current['state']} to {next_state}.")

    patch: dict = {}
    if "state" in data:
        patch["state"] = data["state"]
    if data.get("assignToMe"):
        patch["assignee_id"] = actor_id
    for key, column in (("groupId", "group_id"), ("impact", "impact"), ("urgency", "urgency")):
        if key in data:
            patch[column] = str(data[key]) if key == "groupId" and data[key] is not None else data[key]
    for key, column in (
        ("category", "category"),
        ("subcategory", "subcategory"),
        ("closeCode", "close_code"),
        ("onHoldReason", "on_hold_reason"),
    ):
        if key in data:
            patch[column] = _clean(data[key])
    if "resolutionNotes" in data:
        patch["resolution_notes"] = (data["resolutionNotes"] or "").strip()

    hold_touched = changing_state or "onHoldReason" in data
    if next_state == "pending" and hold_touched:
        reason = patch.get("on_hold_reason", current["on_hold_reason"])
        if not reason or reason not in HOLD_REASONS or ("on_hold_reason" in patch and patch["on_hold_reason"] is None):
            raise WorkflowError("Select a valid hold reason before placing this incident on hold.")
    if next_state != "pending" and hold_touched:
        patch["on_hold_reason"] = None

    reopening = changing_state and next_state == "open" and current["state"] in ("resolved", "closed")
    if reopening:
        patch.update(resolved_at=None, resolution_notes=None, close_code=None, reopen_count=current["reopen_count"] + 1)
    elif next_state in ("resolved", "closed") and (changing_state or "resolutionNotes" in data or "closeCode" in data):
        notes = patch.get("resolution_notes", current["resolution_notes"])
        close_code = patch.get("close_code", current["close_code"])
        if not (notes or "").strip():
            raise WorkflowError("Add resolution notes before resolving or closing this incident.")
        if not close_code or close_code not in CLOSE_CODES:
            raise WorkflowError("Select a valid close code before resolving or closing this incident.")
        if changing_state and next_state == "resolved":
            patch["resolved_at"] = now
        # Closing must keep the original resolution time that SLA reporting measures against.
        if next_state == "closed" and not current["resolved_at"]:
            raise WorkflowError("This incident has no resolution timestamp. Reopen and resolve it before closing.")

    if not current["first_responded_at"] and (
        data.get("assignToMe") or (changing_state and next_state in ("open", "in_progress", "pending", "resolved"))
    ):
        patch["first_responded_at"] = now
    return patch
