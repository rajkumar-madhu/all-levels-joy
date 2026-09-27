import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import { incidentQueueSchema, incidentSearchFilter } from "../src/lib/incident-queue";
import {
  loadIncidentQueue,
  loadIncidentQueueCounts,
  loadIncidentRecord,
} from "../src/lib/incident-queue.server";

const org = "10000000-0000-0000-0000-000000000001";
const user = "20000000-0000-0000-0000-000000000001";
const now = new Date("2026-09-27T12:00:00Z");
function fixture(status = 200, total = "52") {
  const requests: { url: URL; method: string; headers: Headers }[] = [];
  const client = createClient<Database>("https://test.invalid", "test-public-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: new URL(request.url),
          method: request.method,
          headers: request.headers,
        });
        return new Response(
          request.method === "HEAD"
            ? null
            : status >= 400
              ? JSON.stringify({ message: "database down", code: "XX000" })
              : "[]",
          {
            status,
            headers: { "content-type": "application/json", "content-range": `0-24/${total}` },
          },
        );
      },
    },
  });
  return { client, requests };
}

test("queue pagination is server-side and always scoped to the workspace", async () => {
  const { client, requests } = fixture();
  const result = await loadIncidentQueue(
    client,
    org,
    user,
    incidentQueueSchema.parse({ page: 3 }),
    now,
  );
  const url = requests[0]!.url;
  assert.equal(url.searchParams.get("organization_id"), `eq.${org}`);
  assert.equal(url.searchParams.get("offset"), "50");
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("state"), "in.(new,open,in_progress,pending)");
  assert.equal(
    url.searchParams.get("order"),
    "sla_due_at.asc.nullslast,priority.asc,created_at.desc,id.asc",
  );
  assert.equal(result.total, 52);
  assert.equal(result.page, 3);
});
test("my queue uses authenticated user identity, not a user-provided owner", async () => {
  const { client, requests } = fixture();
  await loadIncidentQueue(
    client,
    org,
    user,
    incidentQueueSchema.parse({ queue: "mine", priority: "2", group: "unassigned" }),
    now,
  );
  const params = requests[0]!.url.searchParams;
  assert.equal(params.get("assignee_id"), `eq.${user}`);
  assert.equal(params.get("priority"), "eq.2");
  assert.equal(params.get("group_id"), "is.null");
});
test("due-soon queue includes the next hour without mixing historical breaches", async () => {
  const { client, requests } = fixture();
  await loadIncidentQueue(client, org, user, incidentQueueSchema.parse({ queue: "at_risk" }), now);
  assert.deepEqual(requests[0]!.url.searchParams.getAll("sla_due_at"), [
    "gte.2026-09-27T12:00:00.000Z",
    "lte.2026-09-27T13:00:00.000Z",
  ]);
  assert.match(requests[0]!.url.searchParams.get("state")!, /pending/);
});
test("completed queue includes closed and resolved only", async () => {
  const { client, requests } = fixture();
  await loadIncidentQueue(
    client,
    org,
    user,
    incidentQueueSchema.parse({ queue: "completed" }),
    now,
  );
  assert.equal(requests[0]!.url.searchParams.get("state"), "in.(resolved,closed)");
});
test("queue counts use exact HEAD counts without loading capped row samples", async () => {
  const { client, requests } = fixture();
  const counts = await loadIncidentQueueCounts(client, org, user, now);
  assert.equal(requests.length, 7);
  assert.equal(counts.active, 52);
  assert.ok(
    requests.every(
      (r) =>
        r.method === "HEAD" &&
        r.headers.get("prefer") === "count=exact" &&
        r.url.searchParams.get("organization_id") === `eq.${org}`,
    ),
  );
});
test("record deep links do not depend on current queue or its page", async () => {
  const { client, requests } = fixture();
  await loadIncidentRecord(client, org, user);
  assert.equal(requests[0]!.url.searchParams.get("id"), `eq.${user}`);
  assert.equal(requests[0]!.url.searchParams.get("organization_id"), `eq.${org}`);
  assert.equal(requests[0]!.url.searchParams.has("state"), false);
});
test("backend errors do not masquerade as an empty queue or zero counts", async () => {
  const { client } = fixture(400);
  await assert.rejects(
    loadIncidentQueue(client, org, user, incidentQueueSchema.parse({}), now),
    /could not be loaded/,
  );
  await assert.rejects(loadIncidentQueueCounts(client, org, user, now), /unavailable/);
});
test("input rejects invalid paging and filters; search quotes PostgREST delimiters", () => {
  for (const page of [-1, 0, 1.2, 10001])
    assert.equal(incidentQueueSchema.safeParse({ page }).success, false);
  assert.equal(incidentQueueSchema.safeParse({ group: "other-tenant" }).success, false);
  assert.equal(incidentQueueSchema.safeParse({ priority: "6" }).success, false);
  assert.equal(incidentSearchFilter("%_*"), null);
  assert.equal(
    incidentSearchFilter("VPN, state.eq.closed"),
    'number.ilike."%VPN, state.eq.closed%",title.ilike."%VPN, state.eq.closed%"',
  );
  assert.equal(
    incidentSearchFilter('VPN "gateway"'),
    'number.ilike."%VPN \\"gateway\\"%",title.ilike."%VPN \\"gateway\\"%"',
  );
});
