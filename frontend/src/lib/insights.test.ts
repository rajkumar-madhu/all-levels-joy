import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsedLabel, formatHours, formatSize, niceMax } from "./insights.ts";

test("elapsed labels match the legacy rounding", () => {
  assert.equal(elapsedLabel(0), "1m");
  assert.equal(elapsedLabel(90 * 60_000), "1h 30m");
  assert.equal(elapsedLabel(15 * 60_000), "15m");
});

test("sizes, hours and chart maxima", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatHours(0.25), "15m");
  assert.equal(formatHours(72), "3.0d");
  assert.equal(formatHours(null), "—");
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(40), 50);
});
