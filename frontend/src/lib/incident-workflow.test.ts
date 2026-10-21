import assert from "node:assert/strict";
import { test } from "node:test";
import { INCIDENT_TRANSITIONS } from "./incident-workflow.ts";

test("terminal and reopen transitions match the database trigger", () => {
  assert.deepEqual(INCIDENT_TRANSITIONS.cancelled, []);
  assert.deepEqual(INCIDENT_TRANSITIONS.closed, ["open"]);
  assert.ok(!INCIDENT_TRANSITIONS.resolved.includes("cancelled"));
});
