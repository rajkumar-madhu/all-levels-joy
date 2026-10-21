import assert from "node:assert/strict";
import { test } from "node:test";
import { dueIn, humanize, priorityLabel } from "./format.ts";

test("due labels count down and flag overdue targets", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.deepEqual(dueIn("2030-01-01T00:45:00Z", now), { label: "45m left", overdue: false });
  assert.deepEqual(dueIn("2029-12-31T21:00:00Z", now), { label: "3h overdue", overdue: true });
  assert.deepEqual(dueIn("2030-01-05T00:00:00Z", now), { label: "4d left", overdue: false });
  assert.deepEqual(dueIn(null, now), { label: "No target", overdue: false });
});

test("labels", () => {
  assert.equal(humanize("pending_approval"), "Pending approval");
  assert.equal(priorityLabel(2), "P2");
  assert.equal(priorityLabel(null), "—");
});
