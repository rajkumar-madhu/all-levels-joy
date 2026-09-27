// Explicit local UI fixture. This is not an application route or a live-data preview.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "../../src/components/app-shell";
import { PageHeader } from "../../src/components/page-header";
import { IncidentWorkbench } from "../../src/components/incident-workbench";
import { incidentQueueSchema } from "../../src/lib/incident-queue";
import type { Workspace } from "../../src/lib/workspace-queries";
import type { Database } from "../../src/integrations/supabase/types";
import "../../src/styles.css";

const titles = [
  "Payment gateway returning intermittent timeouts",
  "VPN access unavailable for remote employees",
  "Customer portal login latency above threshold",
  "Database replica replication lag",
  "Email delivery delayed for operations team",
  "Build pipeline unable to reach artifact registry",
  "Analytics dashboard missing overnight data",
  "Office Wi-Fi unstable on the third floor",
];
const stamp = new Date().toISOString();
const records = titles.map(
  (title, index) =>
    ({
      id: `50000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      number: `INC00128${47 - index}`,
      title,
      description: "Synthetic incident for UI interaction checks.",
      state: index === 1 ? "new" : "in_progress",
      priority: (index % 4) + 1,
      assignee_id: index % 3 === 1 ? null : "analyst",
      group_id: "20000000-0000-0000-0000-000000000001",
      service_id: "30000000-0000-0000-0000-000000000001",
      created_at: stamp,
      sla_due_at: new Date(Date.now() + (index - 1) * 1_800_000).toISOString(),
      resolved_at: null,
    }) as Database["public"]["Tables"]["incidents"]["Row"],
);
const workspace = {
  userId: "analyst",
  profile: { display_name: "Alex Morgan" },
  organization: { name: "WeCrew · UI fixture" },
  roles: ["service_desk"],
  incidents: [],
  requests: [],
  changes: [],
  approvals: [],
  notifications: [],
  audit: [],
} as unknown as Workspace;

export function Fixture() {
  const [filters, setFilters] = useState(incidentQueueSchema.parse({}));
  const [selected, setSelected] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  let rows = records.filter(
    (row) =>
      row.title.toLowerCase().includes(filters.q.toLowerCase()) ||
      row.number.toLowerCase().includes(filters.q.toLowerCase()),
  );
  if (filters.priority !== "all")
    rows = rows.filter((row) => row.priority === Number(filters.priority));
  if (filters.queue === "unassigned") rows = rows.filter((row) => !row.assignee_id);
  if (filters.queue === "mine") rows = rows.filter((row) => row.assignee_id === "analyst");
  return (
    <AppShell workspace={workspace}>
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <strong>LOCAL UI FIXTURE · Synthetic data</strong>
        <button onClick={() => setError(!error)}>Toggle error fixture</button>
        <button onClick={() => setLoading(!loading)}>Toggle loading fixture</button>
        <span data-testid="selected">{selected}</span>
      </div>
      <PageHeader
        eyebrow="Service operations"
        title="Incident workspace"
        description="Triage incoming work, protect service targets, and keep every resolution accountable."
      />
      <IncidentWorkbench
        incidents={rows}
        total={rows.length}
        pageSize={25}
        counts={{
          active: 8,
          mine: 5,
          unassigned: 3,
          at_risk: 3,
          breached: 1,
          completed: 0,
          all: 8,
        }}
        countsError={error}
        filters={filters}
        onFilters={(patch) => setFilters((value) => ({ ...value, ...patch }))}
        onSelect={setSelected}
        onRefresh={() => {
          setError(false);
          setLoading(false);
        }}
        loading={loading}
        refreshing={false}
        error={error ? "Simulated database unavailable" : null}
        updatedAt={Date.now()}
        selectedId={selected}
        groups={[{ id: "20000000-0000-0000-0000-000000000001", name: "Platform engineering" }]}
        services={[{ id: "30000000-0000-0000-0000-000000000001", name: "Customer platform" }]}
        people={[{ id: "analyst", display_name: "Alex Morgan" }]}
      />
    </AppShell>
  );
}
const rootRoute = createRootRoute({ component: Outlet });
const fixtureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/incidents",
  component: Fixture,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([fixtureRoute]),
  history: createMemoryHistory({ initialEntries: ["/incidents"] }),
});
const client = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
