"""Pure rules, mirroring tests/incident-workflow.test.ts in the legacy app."""

from datetime import UTC, datetime

import pytest

from apps.incidents.workflow import Conflict, WorkflowError, build_patch

NOW = datetime(2030, 1, 1, tzinfo=UTC)
STAMP = datetime(2029, 12, 31, tzinfo=UTC)


def current(**overrides):
    base = {
        "state": "new",
        "updated_at": STAMP,
        "first_responded_at": None,
        "reopen_count": 0,
        "resolved_at": None,
        "resolution_notes": None,
        "close_code": None,
        "on_hold_reason": None,
    }
    return {**base, **overrides}


def patch(cur, **data):
    return build_patch(cur, {"expectedUpdatedAt": STAMP, **data}, "user-1", NOW)


def test_stale_version_is_rejected():
    with pytest.raises(Conflict):
        build_patch(current(), {"expectedUpdatedAt": NOW, "state": "open"}, "u", NOW)


def test_first_response_is_stamped_once():
    assert patch(current(), state="open")["first_responded_at"] == NOW
    assert "first_responded_at" not in patch(current(first_responded_at=STAMP), state="in_progress")
    assert patch(current(), assignToMe=True) == {"assignee_id": "user-1", "first_responded_at": NOW}


def test_hold_requires_a_known_reason_and_clears_when_leaving_hold():
    with pytest.raises(WorkflowError, match="hold reason"):
        patch(current(), state="pending")
    with pytest.raises(WorkflowError, match="hold reason"):
        patch(current(), state="pending", onHoldReason="lunch")
    assert patch(current(), state="pending", onHoldReason="awaiting_vendor")["on_hold_reason"] == "awaiting_vendor"
    assert patch(current(state="pending", on_hold_reason="awaiting_vendor"), state="open")["on_hold_reason"] is None


def test_resolving_needs_notes_and_close_code():
    with pytest.raises(WorkflowError, match="resolution notes"):
        patch(current(), state="resolved", closeCode="solved_remotely")
    with pytest.raises(WorkflowError, match="close code"):
        patch(current(), state="resolved", resolutionNotes="Restarted the service")
    done = patch(current(), state="resolved", resolutionNotes="Restarted", closeCode="solved_remotely")
    assert done["resolved_at"] == NOW


def test_reopen_clears_resolution_and_counts():
    reopened = patch(
        current(state="resolved", resolved_at=STAMP, resolution_notes="x", close_code="duplicate", reopen_count=1),
        state="open",
    )
    assert reopened["resolved_at"] is None and reopened["close_code"] is None and reopened["reopen_count"] == 2


def test_illegal_transitions_and_closing_without_resolution():
    with pytest.raises(WorkflowError, match="cannot move"):
        patch(current(state="cancelled"), state="open")
    with pytest.raises(WorkflowError, match="no resolution timestamp"):
        patch(current(state="resolved", resolution_notes="x", close_code="duplicate"), state="closed")
