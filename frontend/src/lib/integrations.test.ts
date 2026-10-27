import assert from "node:assert/strict";
import { test } from "node:test";
import { INTEGRATIONS, filterIntegrations } from "./integrations.ts";

test("filters by category and search terms", () => {
  assert.deepEqual(
    filterIntegrations(INTEGRATIONS, "communication", "").map((i) => i.key),
    ["slack", "teams", "email"],
  );
  assert.deepEqual(filterIntegrations(INTEGRATIONS, "all", "grafana").map((i) => i.key), ["monitoring"]);
  assert.deepEqual(filterIntegrations(INTEGRATIONS, "all", "major incident teams").map((i) => i.key), ["teams"]);
  assert.equal(filterIntegrations(INTEGRATIONS, "security", "slack").length, 0);
});

test("every integration names the setting that turns it on", () => {
  for (const item of INTEGRATIONS) assert.ok(item.settings.length > 0, item.key);
});
