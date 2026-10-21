import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PriorityBadge, StateBadge } from "@/components/status-badge";
import { incidentMetricsQuery } from "@/lib/workspace-queries";
import {
  CLOSE_CODES,
  CONTACT_TYPES,
  STATE_LABELS,
  categoryLabel,
  formatHours,
  labelOf,
  type RecordState,
} from "@/lib/itsm-shared";

export const Route = createFileRoute("/_authenticated/incident-insights")({
  head: () => ({
    meta: [
      { title: "Incident dashboard — Argus Service Desk" },
      {
        name: "description",
        content:
          "Incident volume, open backlog by priority, SLA attainment, response and resolution times, categories, and ageing tickets.",
      },
      { property: "og:title", content: "Incident dashboard — Argus Service Desk" },
      {
        property: "og:description",
        content:
          "Incident KPIs: volume trend, backlog by priority, SLA attainment, MTTR, and ageing queue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IncidentInsights,
});

function Bars({
  rows,
  emptyHint,
}: {
  rows: { label: string; count: number }[];
  emptyHint: string;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-xs text-muted-foreground">{emptyHint}</p>;
  }
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <ul className="space-y-2 px-4 py-4">
      {rows.map((row) => (
        <li key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-foreground">{row.label}</span>
            <span className="font-mono text-muted-foreground">{row.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function IncidentInsights() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const metrics = useQuery(incidentMetricsQuery());
  const data = metrics.data;

  const kpis = [
    { label: "Opened (30d)", value: data?.opened ?? 0, hint: "New incidents logged" },
    { label: "Resolved (30d)", value: data?.resolved ?? 0, hint: "Closed or resolved" },
    { label: "Open backlog", value: data?.openTotal ?? 0, hint: "Active right now" },
    { label: "Unassigned", value: data?.unassigned ?? 0, hint: "No owner yet" },
    {
      label: "SLA attainment",
      value:
        data?.slaAttainment === null || data?.slaAttainment === undefined
          ? "—"
          : `${data.slaAttainment.toFixed(0)}%`,
      hint: "Resolved within target",
    },
    {
      label: "Mean time to resolve",
      value: formatHours(data?.mttrHours),
      hint: "Logged to resolved",
    },
    {
      label: "First response",
      value: formatHours(data?.responseHours),
      hint: "Average time to action",
    },
    { label: "Reopened", value: data?.reopened ?? 0, hint: "Came back after resolution" },
  ];

  const maxDay = Math.max(
    ...(data?.days ?? []).map((day) => Math.max(day.opened, day.resolved)),
    1,
  );

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        eyebrow="Service operations"
        title="Incident dashboard"
        description="Volume, backlog, SLA attainment, and resolution performance across the last 30 days."
      />

      {metrics.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : metrics.isError || !data ? (
        <div className="mt-6">
          <EmptyState
            title="We couldn't load the incident figures"
            hint="Refresh the page. If it keeps happening, your access may still be provisioning."
          />
        </div>
      ) : (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-foreground">{kpi.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
              </div>
            ))}
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Panel title="Opened vs resolved — last 14 days">
              <div className="flex items-end gap-1.5 px-4 py-5" aria-hidden>
                {data.days.map((day) => (
                  <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex h-32 w-full items-end justify-center gap-0.5">
                      <div
                        className="w-1/2 rounded-t bg-primary"
                        style={{ height: `${(day.opened / maxDay) * 100}%` }}
                      />
                      <div
                        className="w-1/2 rounded-t bg-success"
                        style={{ height: `${(day.resolved / maxDay) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{day.day.slice(8)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-primary" /> Opened
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-success" /> Resolved
                </span>
                <span>
                  {data.days.reduce((sum, day) => sum + day.opened, 0)} opened ·{" "}
                  {data.days.reduce((sum, day) => sum + day.resolved, 0)} resolved
                </span>
              </div>
            </Panel>

            <Panel title="Open backlog by priority">
              <ul className="divide-y divide-border">
                {data.byPriority.map((row) => (
                  <li key={row.priority} className="flex items-center justify-between px-4 py-2.5">
                    <PriorityBadge priority={row.priority} />
                    <span className="font-mono text-sm text-foreground">{row.open}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
            <Panel title="Open by state">
              <Bars
                rows={data.byState.map((row) => ({
                  label: STATE_LABELS[row.state as RecordState] ?? row.state,
                  count: row.count,
                }))}
                emptyHint="Nothing open at the moment."
              />
            </Panel>
            <Panel title="Categories (30d)">
              <Bars
                rows={data.byCategory.map((row) => ({
                  label: categoryLabel(row.label === "unspecified" ? null : row.label),
                  count: row.count,
                }))}
                emptyHint="No incidents in this window."
              />
            </Panel>
            <Panel title="How incidents arrive">
              <Bars
                rows={data.byContactType.map((row) => ({
                  label: labelOf(CONTACT_TYPES, row.label === "unspecified" ? null : row.label),
                  count: row.count,
                }))}
                emptyHint="No incidents in this window."
              />
            </Panel>
            <Panel title="Resolution codes">
              <Bars
                rows={data.byCloseCode.map((row) => ({
                  label: labelOf(CLOSE_CODES, row.label === "unspecified" ? null : row.label),
                  count: row.count,
                }))}
                emptyHint="No resolved incidents yet."
              />
            </Panel>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
            <Panel title="Open load by service">
              <Bars rows={data.serviceLoad} emptyHint="Nothing open at the moment." />
            </Panel>

            <Panel title="Oldest open incidents">
              {data.ageing.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground">The queue is clear.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Number</th>
                        <th className="px-4 py-2.5 font-medium">Short description</th>
                        <th className="px-4 py-2.5 font-medium">Priority</th>
                        <th className="px-4 py-2.5 font-medium">State</th>
                        <th className="px-4 py-2.5 font-medium">Age</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.ageing.map((row) => (
                        <tr key={row.id} className="hover:bg-muted/60">
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              className="font-mono text-xs text-primary underline underline-offset-4"
                              onClick={() =>
                                void navigate({ to: "/incidents", search: { record: row.id } })
                              }
                            >
                              {row.number}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-foreground">
                            {row.title}
                            {row.service ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {row.service}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5">
                            <PriorityBadge priority={row.priority} />
                          </td>
                          <td className="px-4 py-2.5">
                            <StateBadge state={row.state as RecordState} />
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                            {row.ageDays}d
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>
        </>
      )}
    </AppShell>
  );
}
