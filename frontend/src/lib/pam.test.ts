import assert from "node:assert/strict";
import { test } from "node:test";
import { countdown, defaultPort, durationLabel, isActive, rotationState, verificationState } from "./pam.ts";

const now = Date.parse("2026-10-21T10:00:00Z");

test("access is active only inside an approved window", () => {
  const window = { starts_at: "2026-10-21T09:00:00Z", expires_at: "2026-10-21T11:00:00Z" };
  assert.equal(isActive({ status: "approved", ...window }, now), true);
  assert.equal(isActive({ status: "pending", ...window }, now), false);
  assert.equal(isActive({ status: "approved", ...window, expires_at: "2026-10-21T10:00:00Z" }, now), false);
});

test("countdown formats hours, minutes and seconds", () => {
  assert.equal(countdown("2026-10-21T11:04:09Z", now), "1:04:09");
  assert.equal(countdown("2026-10-21T10:12:05Z", now), "12:05");
  assert.equal(countdown("2026-10-21T09:00:00Z", now), "0:00");
});

test("rotation and verification states", () => {
  assert.equal(rotationState({ rotation_enabled: false, password_changed_at: null, last_rotation_error: null }).label, "Never rotated");
  assert.equal(rotationState({ rotation_enabled: true, password_changed_at: null, last_rotation_error: "x" }).label, "Rotation failed");
  assert.equal(verificationState({ last_verified_at: null, last_verification_ok: null }).label, "Never");
  assert.equal(verificationState({ last_verified_at: "2026-10-21T09:00:00Z", last_verification_ok: false }).tone, "bad");
});

test("duration labels", () => {
  assert.equal(durationLabel(30), "30 min");
  assert.equal(durationLabel(240), "4 h");
  assert.equal(durationLabel(1440), "24 hours");
});

test("default ports follow the template and engine", () => {
  assert.equal(defaultPort("ssh"), 22);
  assert.equal(defaultPort("database"), 5432);
  assert.equal(defaultPort("database", "mysql"), 3306);
  assert.equal(defaultPort("windows"), 5986);
});
