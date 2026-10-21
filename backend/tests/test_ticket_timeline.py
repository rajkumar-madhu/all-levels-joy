"""Mirrors tests/ticket-timeline.test.ts and tests/incident-sla.test.ts in the legacy app."""

from datetime import datetime, timedelta

from apps.insights.timeline import (
    incident_sla_attainment,
    sla_state,
    ticket_sla_details,
    ticket_sla_targets,
    ticket_timeline,
    to_datetime,
)

TICKET = {"created_at": "2026-10-14T08:00:00Z", "state": "open"}
SLA = {
    "id": "sla",
    "target_type": "resolution",
    "started_at": TICKET["created_at"],
    "due_at": "2026-10-14T10:00:00Z",
    "completed_at": None,
    "paused_at": None,
    "status": "running",
}


def at(value: str) -> datetime:
    return to_datetime(value)


def event(id_, when, before, after):
    return {
        "id": id_,
        "created_at": when,
        "source": "database",
        "action": "updated",
        "actor_id": "staff",
        "before_values": before,
        "after_values": after,
    }


def test_legacy_incidents_still_show_their_recorded_deadline():
    targets = ticket_sla_targets({**TICKET, "sla_due_at": "2026-10-14T10:00:00Z"}, [])
    assert targets[0]["due_at"] == "2026-10-14T10:00:00Z"


def test_opened_assigned_and_closed_use_exact_recorded_times():
    timeline = ticket_timeline(
        TICKET,
        [
            event("a", "2026-10-14T09:00:00Z", {"assignee_id": None}, {"assignee_id": "staff"}),
            event("c", "2026-10-14T12:00:00Z", {"state": "resolved"}, {"state": "closed"}),
        ],
    )
    assert [(e["label"], e["at"]) for e in timeline] == [
        ("Opened", at(TICKET["created_at"])),
        ("Assigned", at("2026-10-14T09:00:00Z")),
        ("Closed", at("2026-10-14T12:00:00Z")),
    ]


def test_never_invents_closure_time_from_record_update_time():
    assert not any(e["label"] == "Closed" for e in ticket_timeline({**TICKET, "state": "closed"}, []))


def test_application_events_are_ignored():
    ignored = [{**event("x", "2026-10-14T09:00:00Z", {"state": "new"}, {"state": "open"}), "source": "application"}]
    assert [e["label"] for e in ticket_timeline(TICKET, ignored)] == ["Opened"]


def test_live_breach_is_measured_against_the_deadline():
    result = ticket_sla_details(SLA, [], at("2026-10-14T11:30:00Z"), TICKET)
    assert result["state"] == "Breached" and result["overdueMs"] == 90 * 60000


def test_resolution_freezes_lateness_even_if_stored_sla_still_says_running():
    resolved = [{"id": "r", "label": "Resolved", "at": at("2026-10-14T10:30:00Z")}]
    result = ticket_sla_details(SLA, resolved, at("2026-10-15T12:00:00Z"), {**TICKET, "state": "closed"})
    assert result["overdueMs"] == 30 * 60000 and result["completedAt"] == at("2026-10-14T10:30:00Z")


def test_paused_clock_does_not_accumulate_further_lateness():
    paused = {**SLA, "status": "paused", "paused_at": "2026-10-14T10:15:00Z"}
    result = ticket_sla_details(paused, [], at("2026-10-15T12:00:00Z"), TICKET)
    assert result["state"] == "Breached · paused" and result["overdueMs"] == 15 * 60000


def test_no_breach_at_the_exact_deadline():
    assert ticket_sla_details(SLA, [], at(SLA["due_at"]), TICKET)["state"] == "Running"


def test_closed_without_a_completion_record_is_unavailable_not_late():
    result = ticket_sla_details(SLA, [], at("2026-10-20T00:00:00Z"), {**TICKET, "state": "closed"})
    assert result["state"] == "Completion time unavailable" and result["overdueMs"] is None


DUE = "2026-09-27T12:00:00Z"
NOW = at("2026-09-27T11:00:00Z")


def test_late_resolution_remains_a_breach_after_closure():
    assert sla_state(DUE, "2026-09-27T12:01:00Z", NOW) == "completed_late"


def test_no_target_is_not_a_met_sla():
    assert sla_state(None, "2026-09-27T12:01:00Z", NOW) == "none"


def test_resolution_exactly_at_the_deadline_is_met():
    assert sla_state(DUE, DUE, NOW) == "completed"


def test_active_deadline_boundaries_are_deterministic():
    assert sla_state(DUE, None, NOW) == "at_risk"
    assert sla_state(DUE, None, NOW - timedelta(milliseconds=1)) == "on_track"
    assert sla_state(DUE, None, at(DUE)) == "at_risk"
    assert sla_state(DUE, None, at(DUE) + timedelta(milliseconds=1)) == "breached"


def test_invalid_timestamps_are_unavailable_instead_of_healthy():
    assert sla_state("invalid", None, NOW) == "none"
    assert sla_state(DUE, "invalid", NOW) == "none"


def test_attainment_ignores_rows_without_a_target():
    rows = [
        {"resolved_at": "2026-01-01T10:00:00Z", "sla_due_at": "2026-01-01T11:00:00Z"},
        {"resolved_at": "2026-01-01T12:00:00Z", "sla_due_at": "2026-01-01T11:00:00Z"},
        {"resolved_at": "2026-01-01T12:00:00Z", "sla_due_at": None},
    ]
    assert incident_sla_attainment(rows) == 50
    assert incident_sla_attainment([]) is None
