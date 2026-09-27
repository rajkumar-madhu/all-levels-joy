import { test } from "node:test";
import assert from "node:assert/strict";
import { slaState } from "../src/lib/itsm-shared";

const due = "2026-09-27T12:00:00Z";
const now = Date.parse("2026-09-27T11:00:00Z");

test("late resolution remains a breach after closure", () => {
  assert.equal(slaState(due, "2026-09-27T12:01:00Z"), "completed_late");
});
test("no target is not a met SLA even after resolution", () => {
  assert.equal(slaState(null, "2026-09-27T12:01:00Z"), "none");
});
test("resolution exactly at the deadline is met", () => {
  assert.equal(slaState(due, due), "completed");
});
test("active deadline boundaries are deterministic", () => {
  assert.equal(slaState(due, null, now), "at_risk");
  assert.equal(slaState(due, null, now - 1), "on_track");
  assert.equal(slaState(due, null, Date.parse(due)), "at_risk");
  assert.equal(slaState(due, null, Date.parse(due) + 1), "breached");
});
test("invalid timestamps are unavailable instead of healthy", () => {
  assert.equal(slaState("invalid", null, now), "none");
  assert.equal(slaState(due, "invalid", now), "none");
});
