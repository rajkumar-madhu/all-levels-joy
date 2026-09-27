import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  allowedIncidentTransitions,
  buildIncidentWorkflowPatch,
  canManageIncidents,
  incidentSlaAttainment,
  incidentUpdateSchema,
  type IncidentWorkflowCurrent,
  type IncidentWorkflowInput,
} from "../src/lib/incident-workflow";
import { RECORD_STATES, type RecordState } from "../src/lib/itsm-shared";

const version = "2026-09-27T10:00:00.123456+00:00";
const now = "2026-09-27T11:00:00.000Z";
const actor = "90000000-0000-0000-0000-000000000001";
const initial: IncidentWorkflowCurrent = {
  state: "new",
  updated_at: version,
  first_responded_at: null,
  resolved_at: null,
  resolution_notes: null,
  close_code: null,
  on_hold_reason: null,
  reopen_count: 0,
};
const update: IncidentWorkflowInput = {
  id: "50000000-0000-0000-0000-000000000001",
  expectedUpdatedAt: version,
};

test("incident management roles match the server permission boundary", () => {
  assert.equal(
    canManageIncidents(["requester", "cab_member", "cmdb_manager", "change_manager"]),
    false,
  );
  for (const role of ["service_desk", "fulfiller", "manager", "admin"] as const) {
    assert.equal(canManageIncidents([role]), true);
  }
});

test("the complete state matrix rejects shortcuts and supports same-state metadata", () => {
  const allowed: Record<RecordState, readonly RecordState[]> = {
    new: ["open", "in_progress", "pending", "resolved", "cancelled"],
    open: ["in_progress", "pending", "resolved", "cancelled"],
    in_progress: ["open", "pending", "resolved", "cancelled"],
    pending: ["open", "in_progress", "resolved", "cancelled"],
    resolved: ["closed", "open"],
    closed: ["open"],
    cancelled: [],
  };
  for (const from of RECORD_STATES) {
    assert.deepEqual(allowedIncidentTransitions(from), allowed[from]);
    for (const to of RECORD_STATES) {
      const current = { ...initial, state: from, resolved_at: now };
      const input = {
        ...update,
        state: to,
        onHoldReason: "awaiting_vendor",
        closeCode: "solved_permanently",
        resolutionNotes: "Service restored and validated.",
      };
      if (to === from || allowed[from].includes(to)) {
        assert.doesNotThrow(() => buildIncidentWorkflowPatch(current, input, actor, now));
      } else {
        assert.throws(() => buildIncidentWorkflowPatch(current, input, actor, now), /cannot move/);
      }
    }
  }
});

test("pending requires a known hold reason and leaving pending clears it", () => {
  for (const reason of [undefined, null, "", "unknown", "toString"]) {
    assert.throws(
      () =>
        buildIncidentWorkflowPatch(
          initial,
          { ...update, state: "pending", onHoldReason: reason },
          actor,
        ),
      /valid hold reason/,
    );
  }
  const held = buildIncidentWorkflowPatch(
    initial,
    { ...update, state: "pending", onHoldReason: "awaiting_caller" },
    actor,
    now,
  );
  assert.equal(held.on_hold_reason, "awaiting_caller");
  const resumed = buildIncidentWorkflowPatch(
    { ...initial, state: "pending", on_hold_reason: "awaiting_caller" },
    { ...update, state: "in_progress" },
    actor,
    now,
  );
  assert.equal(resumed.on_hold_reason, null);
});

test("resolution requires both nonblank notes and an allowed close code", () => {
  assert.throws(
    () =>
      buildIncidentWorkflowPatch(
        initial,
        { ...update, state: "resolved", resolutionNotes: "   ", closeCode: "solved_permanently" },
        actor,
      ),
    /resolution notes/,
  );
  for (const closeCode of [undefined, null, "invalid", "toString"]) {
    assert.throws(
      () =>
        buildIncidentWorkflowPatch(
          initial,
          { ...update, state: "resolved", resolutionNotes: "Restored", closeCode },
          actor,
        ),
      /valid close code/,
    );
  }
  const patch = buildIncidentWorkflowPatch(
    initial,
    {
      ...update,
      state: "resolved",
      resolutionNotes: "  Restored and checked  ",
      closeCode: "solved_workaround",
    },
    actor,
    now,
  );
  assert.equal(patch.resolution_notes, "Restored and checked");
  assert.equal(patch.resolved_at, now);
  assert.equal(patch.first_responded_at, now);
});

test("closing preserves the original resolution time and evidence", () => {
  const resolved = {
    ...initial,
    state: "resolved" as const,
    resolved_at: "2026-09-27T10:30:00Z",
    resolution_notes: "Fixed",
    close_code: "solved_permanently",
  };
  const patch = buildIncidentWorkflowPatch(resolved, { ...update, state: "closed" }, actor, now);
  assert.equal(patch.resolved_at, undefined);
  assert.equal(patch.resolution_notes, undefined);
  assert.equal(patch.close_code, undefined);
  assert.throws(
    () => buildIncidentWorkflowPatch(resolved, { ...update, resolutionNotes: "" }, actor, now),
    /resolution notes/,
  );
});

test("reopen clears previous resolution evidence and increments exactly once", () => {
  for (const state of ["resolved", "closed"] as const) {
    const patch = buildIncidentWorkflowPatch(
      {
        ...initial,
        state,
        reopen_count: 3,
        resolved_at: now,
        resolution_notes: "Old fix",
        close_code: "solved_permanently",
      },
      { ...update, state: "open", resolutionNotes: "Old fix", closeCode: "solved_permanently" },
      actor,
      now,
    );
    assert.equal(patch.reopen_count, 4);
    assert.equal(patch.resolved_at, null);
    assert.equal(patch.resolution_notes, null);
    assert.equal(patch.close_code, null);
    const repeated = buildIncidentWorkflowPatch(
      { ...initial, state: "open", reopen_count: 4 },
      { ...update, state: "open" },
      actor,
      now,
    );
    assert.equal(repeated.reopen_count, undefined);
  }
});

test("stale versions are rejected before metadata or state changes", () => {
  assert.throws(
    () =>
      buildIncidentWorkflowPatch(
        initial,
        { ...update, expectedUpdatedAt: "2026-09-27T10:00:00.123455+00:00", assignToMe: true },
        actor,
      ),
    /changed after you opened/,
  );
  assert.equal(incidentUpdateSchema.safeParse({ id: update.id, state: "open" }).success, false);
  assert.equal(incidentUpdateSchema.safeParse(update).success, true);
});

test("self assignment uses the actor and classification edits do not claim a response", () => {
  const assigned = buildIncidentWorkflowPatch(initial, { ...update, assignToMe: true }, actor, now);
  assert.equal(assigned.assignee_id, actor);
  assert.equal(assigned.first_responded_at, now);
  const classified = buildIncidentWorkflowPatch(
    initial,
    { ...update, category: "network", impact: 1 },
    actor,
    now,
  );
  assert.equal(classified.first_responded_at, undefined);
  const answered = buildIncidentWorkflowPatch(
    { ...initial, first_responded_at: "2026-09-27T10:01:00Z" },
    { ...update, assignToMe: true },
    actor,
    now,
  );
  assert.equal(answered.first_responded_at, undefined);
});

test("SLA attainment excludes no-target records and retains breached resolutions", () => {
  const rows = [
    { resolved_at: "2026-09-27T11:00:00Z", sla_due_at: "2026-09-27T11:00:00Z" },
    { resolved_at: "2026-09-27T11:00:01Z", sla_due_at: "2026-09-27T11:00:00Z" },
    { resolved_at: "2026-09-27T11:00:00Z", sla_due_at: null },
    { resolved_at: null, sla_due_at: "2026-09-27T11:00:00Z" },
  ];
  assert.equal(incidentSlaAttainment(rows), 50);
  assert.equal(incidentSlaAttainment(rows.slice(2)), null);
  assert.equal(incidentSlaAttainment([]), null);
});
