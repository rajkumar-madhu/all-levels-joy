import assert from "node:assert/strict";
import { test } from "node:test";
import { timeZones } from "./timezones.ts";

test("UTC first, real zones included, and an unknown saved value kept", () => {
  const zones = timeZones("Mars/Olympus_Mons");
  assert.equal(zones[0], "UTC");
  assert.ok(zones.includes("Asia/Kolkata"));
  assert.ok(zones.includes("Mars/Olympus_Mons"));
  assert.equal(new Set(zones).size, zones.length);
});
