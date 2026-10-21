import assert from "node:assert/strict";
import { test } from "node:test";
import { localWindowTimeToIso, securityWindowPayload, windowTimeToLocalInput } from "./security-window.ts";

test("local window times convert to offset-aware UTC in the browser", () => {
  process.env.TZ = "Asia/Kolkata";
  assert.equal(localWindowTimeToIso("2030-01-01T10:00"), "2030-01-01T04:30:00.000Z");
  assert.equal(windowTimeToLocalInput("2030-01-01T04:30:00.000Z"), "2030-01-01T10:00");
});

test("malformed or reversed windows are rejected before reaching the API", () => {
  assert.throws(() => localWindowTimeToIso("2030-01-01 10:00"), /valid window/);
  assert.throws(() => securityWindowPayload("2030-01-01T11:00", "2030-01-01T10:00"), /end after it starts/);
});
