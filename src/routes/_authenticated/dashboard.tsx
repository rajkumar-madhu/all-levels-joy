import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { SecurityMetrics } from "@/components/security-metrics";
import { ConnectedStack } from "@/components/connected-stack";
import { canManage } from "@/lib/itsm-shared";
import { PriorityBadge, SlaBadge, StateBadge } from "@/components/status-badge";
import {
  BRIDGE_STATE_LABELS,
  ROLE_LABELS,
  formatDateTime,
  relativeTime,
  slaState,
  type AppRole,
  type BridgeState,
  type RecordState,
} from "@/lib/itsm-shared";
import { getIntegrationStatus } from "@/lib/integration-status.functions";
import {
  commandCenterQuery,
  incidentMetricsQuery,
  problemBoardQuery,
  referenceQuery,
} from "@/lib/workspace-queries";

const PRIORITY_NAMES: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Moderate",
  4: "Low",
};

function RequestQueues({
  requests,
  groups,
}: {
  requests: Array<{ group_id: string | null; priority: number; due_at: string | null }>;
  groups: Array<{ id: string; name: string }>;
}) {
  const rows = new Map<
    string,
    {
      team: string;
      groupId: string | null;
      priority: number;
      onTrack: number;
      atRisk: number;
      breached: number;
    }
  >();
  for (const r of requests) {
    const key = `${r.group_id ?? "none"}:${r.priority}`;
    const row = rows.get(key) ?? {
      team: groups.find((g) => g.id === r.group_id)?.name ?? "Unassigned team",
      groupId: r.group_id,
      priority: r.priority,
      onTrack: 0,
      atRisk: 0,
      breached: 0,
    };
    const s = slaState(r.due_at, null);
    if (s === "breached") row.breached++;
    else if (s === "at_risk") row.atRisk++;
    else row.onTrack++;
    rows.set(key, row);
  }
  const list = [...rows.values()].sort(
    (a, b) => a.team.localeCompare(b.team) || a.priority - b.priority,
  );
  return (
    <section className="mt-6 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">Request queues</h2>
        <div className="flex items-center gap-3">
          <Link to="/sla" className="text-xs underline underline-offset-4">
            SLA dashboard
          </Link>
          <Link to="/requests" className="text-xs underline underline-offset-4">
            All requests
          </Link>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">No open requests.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-1.5 font-semibold">Team</th>
              <th className="px-3 py-1.5 font-semibold">Priority</th>
              <th className="px-3 py-1.5 font-semibold">On track</th>
              <th className="px-3 py-1.5 font-semibold">At risk</th>
              <th className="px-3 py-1.5 font-semibold">Breached</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={`${row.groupId}:${row.priority}`} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <Link
                    to="/requests"
                    search={{ team: row.groupId ?? undefined, priority: String(row.priority) }}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {row.team}
                  </Link>
                </td>
                <td className="px-3 py-1.5">{PRIORITY_NAMES[row.priority] ?? row.priority}</td>
                <td className="px-3 py-1.5">{row.onTrack}</td>
                <td className="px-3 py-1.5 text-warning">{row.atRisk}</td>
                <td className="px-3 py-1.5 text-destructive">{row.breached}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Platform dashboard — Argus Service Desk" },
      {
        name: "description",
        content:
          "Live view of incident load, SLA exposure, pending approvals, and change schedule.",
      },
      { property: "og:title", content: "Operations dashboard — Argus Service Desk" },
      {
        property: "og:description",
        content: "Incident load, SLA risk, approvals, and change calendar.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const problemBoard = useQuery(problemBoardQuery());
  const reference = useQuery(referenceQuery());
  const commandCenter = useQuery(commandCenterQuery());
  const incidentMetrics = useQuery(incidentMetricsQuery());
  const integrations = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => getIntegrationStatus({ data: { force: false } }),
    enabled: (workspace.data?.roles ?? []).includes("admin"),
  });
  const data = workspace.data;

  const incidents = data?.incidents ?? [];
  const openIncidents = incidents.filter(
    (item) => !["resolved", "closed", "cancelled"].includes(item.state),
  );
  const breached = openIncidents.filter(
    (item) => slaState(item.sla_due_at, item.resolved_at) === "breached",
  );
  const atRisk = openIncidents.filter(
    (item) => slaState(item.sla_due_at, item.resolved_at) === "at_risk",
  );
  const openRequests = (data?.requests ?? []).filter(
    (item) => !["resolved", "closed", "cancelled"].includes(item.state),
  );
  const upcomingChanges = (data?.changes ?? []).filter(
    (item) => !["closed", "cancelled"].includes(item.state),
  );
  const changesPendingApproval = upcomingChanges.filter(
    (item) => item.approval_status === "requested",
  );
  const activeImplementations = upcomingChanges.filter((item) => item.state === "in_progress");
  const overdueReviews = (data?.changes ?? []).filter(
    (item) => item.state === "resolved" && !item.closed_at,
  );
  const roles = (data?.roles ?? []) as AppRole[];
  const pendingApprovals = (data?.approvals ?? []).filter(
    (item) => item.status === "requested" && item.approver_id === data?.userId,
  );
  const articles = (reference.data?.knowledge ?? []).slice(0, 12);
  const catalog = (reference.data?.catalog ?? []).slice(0, 12);
  const assetRows = reference.data?.assets ?? [];
  const assets = assetRows.slice(0, 12);
  const services = reference.data?.services ?? [];
  // The reporting query calculates attainment from resolved incidents with a
  // target, instead of treating unresolved work as an SLA success.
  const slaCompliance = incidentMetrics.data?.slaAttainment ?? null;
  const slaComplianceValue = incidentMetrics.isError
    ? "Unavailable"
    : slaCompliance === null
      ? "—"
      : `${Math.round(slaCompliance)}%`;
  const slaComplianceHint = incidentMetrics.isError
    ? "report unavailable"
    : slaCompliance === null
      ? "no resolved targets"
      : incidentMetrics.data?.sampledRecent
        ? "latest 1,000 · 30d"
        : "resolved within target · 30d";
  const p1Open = openIncidents.filter((item) => item.priority === 1).length;
  const serviceHealth = services.map((service) => {
    const related = openIncidents.filter((item) => item.service_id === service.id);
    const hurt = related.filter(
      (item) => slaState(item.sla_due_at, item.resolved_at) === "breached",
    ).length;
    return { id: service.id, name: service.name, open: related.length, hurt };
  });
  const assetDown = assetRows.filter((item) => item.status !== "operational").length;
  const openProblems = (problemBoard.data?.problems ?? [])
    .filter((item) => !["resolved", "closed", "cancelled"].includes(item.state))
    .sort(
      (a, b) => (a.priority ?? 5) - (b.priority ?? 5) || b.updated_at.localeCompare(a.updated_at),
    );
  const problemLinks = problemBoard.data?.links ?? [];
  const activeBridges = (commandCenter.data?.majors ?? [])
    .filter((item) => item.bridge_state !== "resolved")
    .sort((a, b) => a.severity - b.severity || b.escalation_level - a.escalation_level);
  const bridgeIncidents = commandCenter.data?.incidents ?? [];

  const metrics: {
    label: string;
    value: number;
    hint: string;
    to?:
      | "/incidents"
      | "/command-center"
      | "/problems"
      | "/sla"
      | "/requests"
      | "/approvals"
      | "/changes";
  }[] = [
    {
      label: "Open incidents",
      value: openIncidents.length,
      hint: `${incidents.length} total logged`,
      to: "/incidents" as const,
    },
    {
      label: "Active bridges",
      value: activeBridges.length,
      hint: "Major incidents in command",
      to: "/command-center" as const,
    },
    {
      label: "Open problems",
      value: openProblems.length,
      hint: "Root cause investigations",
      to: "/problems" as const,
    },
    {
      label: "SLA breached",
      value: breached.length,
      hint: "Needs immediate attention",
      to: "/sla" as const,
    },
    {
      label: "SLA at risk",
      value: atRisk.length,
      hint: "Due within the hour",
      to: "/sla" as const,
    },
    {
      label: "Open requests",
      value: openRequests.length,
      hint: "In fulfillment",
      to: "/requests" as const,
    },
    {
      label: "Awaiting approval",
      value: (data?.approvals ?? []).filter((item) => item.status === "requested").length,
      hint: "Assigned to you",
      to: "/approvals" as const,
    },
    {
      label: "Change approvals",
      value: changesPendingApproval.length,
      hint: "Awaiting CAB decisions",
      to: "/changes" as const,
    },
    {
      label: "Implementing",
      value: activeImplementations.length,
      hint: "Changes being delivered",
      to: "/changes" as const,
    },
    {
      label: "Change reviews",
      value: overdueReviews.length,
      hint: "Delivered, awaiting closure",
      to: "/changes" as const,
    },
  ];

  return (
    <AppShell workspace={data}>
      <section className="rounded-lg bg-sidebar px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              Unified service operations
            </p>
            <h1 className="mt-1.5 text-3xl text-white">
              {data?.organization?.name ?? "Service workspace"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${breached.length > 0 || p1Open > 0 ? "bg-brand" : "bg-success"}`}
                aria-hidden
              />
              <span>
                {breached.length > 0 || p1Open > 0 ? "Attention needed" : "Holding steady"}
              </span>
              <span className="text-white/40">·</span>
              <span className="font-mono text-white/70">
                {now.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </span>
              <span className="text-white/40">·</span>
              <span className="font-mono text-white/60">
                {now.toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/incidents"
              className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white"
            >
              Incidents
            </Link>
            <Link
              to="/changes"
              className="rounded-md border border-white/25 px-3 py-2 text-xs font-semibold text-white"
            >
              Changes
            </Link>
            {canManage(roles) ? (
              <Link
                to="/security"
                className="rounded-md border border-white/25 px-3 py-2 text-xs font-semibold text-white"
              >
                Security
              </Link>
            ) : null}
            {roles.includes("admin") ? (
              <Link
                to="/integrations"
                className="rounded-md border border-white/25 px-3 py-2 text-xs font-semibold text-white"
              >
                Integrations
              </Link>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-white/25 px-3 py-2 text-xs font-semibold text-white"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["workspace"] });
                void queryClient.invalidateQueries({ queryKey: ["incident-metrics"] });
                void queryClient.invalidateQueries({ queryKey: ["reference"] });
                void queryClient.invalidateQueries({ queryKey: ["problem-board"] });
                void queryClient.invalidateQueries({ queryKey: ["command-center"] });
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-white/15 bg-white/15 sm:grid-cols-3">
          {[
            { label: "SLA · 30d", value: slaComplianceValue, hint: slaComplianceHint },
            { label: "P1 open", value: String(p1Open), hint: "critical" },
            {
              label: "Assets",
              value: reference.isSuccess ? String(assetRows.length) : "—",
              hint: reference.isError
                ? "unavailable"
                : assetDown
                  ? `${assetDown} not operational`
                  : "in CMDB",
            },
          ].map((item) => (
            <div key={item.label} className="bg-sidebar px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/60">{item.label}</p>
              <p className="mt-1 font-mono text-2xl text-white">{item.value}</p>
              <p className="text-xs text-white/60">{item.hint}</p>
            </div>
          ))}
        </div>
      </section>
      {canManage(roles) ? <SecurityMetrics /> : null}

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : workspace.isError ? (
        <div className="mt-6">
          <EmptyState
            title="We couldn't load your workspace"
            hint="Refresh the page. If it keeps happening, your access may still be provisioning."
          />
        </div>
      ) : (
        <>
          <section
            className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 lg:grid-cols-8"
            aria-label="Platform signals"
          >
            {[
              { label: "Incidents", value: openIncidents.length, hint: "open" },
              { label: "P1", value: p1Open, hint: "critical" },
              { label: "SLA risk", value: atRisk.length, hint: "at risk" },
              { label: "Breached", value: breached.length, hint: "open" },
              { label: "Requests", value: openRequests.length, hint: "open" },
              { label: "Changes", value: upcomingChanges.length, hint: "open" },
              { label: "Problems", value: openProblems.length, hint: "open" },
              { label: "SLA · 30d", value: slaComplianceValue, hint: slaComplianceHint },
            ].map((signal) => (
              <div key={signal.label} className="bg-card px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {signal.label}
                </p>
                <p className="mt-1 font-mono text-2xl text-foreground">{signal.value}</p>
                <p className="text-[11px] text-muted-foreground">{signal.hint}</p>
              </div>
            ))}
          </section>
          <p className="mt-1 text-xs text-muted-foreground">
            Queue counts use the records loaded for this dashboard, up to 200 per module. Open a
            module for its full searchable queue.
          </p>

          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((metric) =>
              metric.to ? (
                <Link
                  key={metric.label}
                  to={metric.to}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/60"
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
                </Link>
              ) : (
                <div key={metric.label} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
                </div>
              ),
            )}
          </section>

          {canManage(roles) ? (
            <ConnectedStack
              incidents={incidents}
              assets={(reference.data?.assets ?? []) as never}
            />
          ) : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold text-foreground">Active major incidents</h2>
                  <Link to="/command-center" className="text-xs underline underline-offset-4">
                    Open command
                  </Link>
                </div>
                {commandCenter.isPending ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Loading command bridges…
                  </p>
                ) : commandCenter.isError ? (
                  <p className="px-3 py-4 text-sm text-destructive">
                    Command bridges are temporarily unavailable.
                  </p>
                ) : activeBridges.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No active major incidents.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {activeBridges.slice(0, 12).map((bridge) => {
                      const incident = bridgeIncidents.find(
                        (item) => item.id === bridge.incident_id,
                      );
                      const overdue = Boolean(
                        bridge.next_update_at && new Date(bridge.next_update_at) < new Date(),
                      );
                      return (
                        <li key={bridge.id} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to="/command-center"
                              search={{ record: bridge.id }}
                              className="font-mono text-xs text-primary underline underline-offset-4"
                            >
                              {bridge.number}
                            </Link>
                            <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                              Sev {bridge.severity}
                            </span>
                            <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                              {BRIDGE_STATE_LABELS[bridge.bridge_state as BridgeState] ??
                                bridge.bridge_state}
                            </span>
                            {overdue ? (
                              <span className="rounded-md border border-warning/50 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                                Update due
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-foreground">
                            {incident?.number ?? "Incident"} ·{" "}
                            {incident?.title ?? bridge.situation_summary ?? "Major incident"}
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            Escalation L{bridge.escalation_level} ·{" "}
                            {bridge.situation_summary ?? "No situation summary"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    Open problem investigations
                  </h2>
                  <Link to="/problems" className="text-xs underline underline-offset-4">
                    Open problems
                  </Link>
                </div>
                {problemBoard.isPending ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Loading problem investigations…
                  </p>
                ) : problemBoard.isError ? (
                  <p className="px-3 py-4 text-sm text-destructive">
                    Problem investigations are temporarily unavailable.
                  </p>
                ) : openProblems.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No open problem investigations.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {openProblems.slice(0, 12).map((problem) => (
                      <li key={problem.id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/problems"
                            search={{ record: problem.id }}
                            className="font-mono text-xs text-primary underline underline-offset-4"
                          >
                            {problem.number}
                          </Link>
                          <PriorityBadge priority={problem.priority} />
                          <StateBadge state={problem.state as RecordState} />
                          {problem.known_error ? (
                            <span className="rounded-md border border-warning/50 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                              Known error
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-sm font-medium text-foreground">
                          {problem.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {problemLinks.filter((link) => link.problem_id === problem.id).length}{" "}
                          linked incidents · updated {relativeTime(problem.updated_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold text-foreground">Priority incident queue</h2>
                  <Link to="/incidents" className="text-xs underline underline-offset-4">
                    Open queue
                  </Link>
                </div>
                {openIncidents.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No open incidents. Nice and quiet.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {openIncidents.slice(0, 12).map((incident) => (
                      <li key={incident.id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/incidents"
                            search={{ record: incident.id }}
                            className="font-mono text-xs text-primary underline underline-offset-4"
                          >
                            {incident.number}
                          </Link>
                          <PriorityBadge priority={incident.priority} />
                          <StateBadge state={incident.state} />
                          <SlaBadge dueAt={incident.sla_due_at} resolvedAt={incident.resolved_at} />
                        </div>
                        <p className="mt-1.5 text-sm font-medium text-foreground">
                          {incident.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Logged {relativeTime(incident.created_at)} · Due{" "}
                          {formatDateTime(incident.sla_due_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <RequestQueues requests={openRequests} groups={reference.data?.groups ?? []} />
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold text-foreground">Change schedule</h2>
                  <Link to="/changes" className="text-xs underline underline-offset-4">
                    View all
                  </Link>
                </div>
                {upcomingChanges.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No changes scheduled.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {upcomingChanges.slice(0, 12).map((change) => (
                      <li key={change.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Link
                            to="/changes"
                            search={{ record: change.id }}
                            className="font-mono text-xs text-primary underline underline-offset-4"
                          >
                            {change.number}
                          </Link>
                          <StateBadge state={change.state} />
                        </div>
                        <p className="mt-1 font-medium text-foreground">{change.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Window {formatDateTime(change.start_at)} → {formatDateTime(change.end_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <h2 className="text-sm font-semibold text-foreground">Your access</h2>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {roles.length === 0 ? (
                    <li className="text-sm text-muted-foreground">No roles assigned yet.</li>
                  ) : (
                    roles.map((role) => (
                      <li
                        key={role}
                        className="rounded border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                      >
                        {ROLE_LABELS[role]}
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-card">
                <h2 className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
                  Recent notifications
                </h2>
                <ul className="divide-y divide-border">
                  {(data?.notifications ?? []).slice(0, 12).map((item) => (
                    <li key={item.id} className="px-3 py-2 text-sm">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.body} · {relativeTime(item.created_at)}
                      </p>
                    </li>
                  ))}
                  {(data?.notifications ?? []).length === 0 ? (
                    <li className="px-3 py-4 text-sm text-muted-foreground">
                      Nothing new for you.
                    </li>
                  ) : null}
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    Approvals waiting on you
                  </h2>
                  <Link to="/approvals" className="text-xs underline underline-offset-4">
                    Open approvals
                  </Link>
                </div>
                {pendingApprovals.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No approvals are waiting.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {pendingApprovals.slice(0, 12).map((approval) => (
                      <li key={approval.id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/approvals"
                            className="font-mono text-xs capitalize text-primary underline underline-offset-4"
                          >
                            {approval.record_type}
                          </Link>
                          <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                            {approval.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Raised {formatDateTime(approval.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <h2 className="text-sm font-semibold text-foreground">Service health</h2>
                <Link to="/assets" className="text-xs underline underline-offset-4">
                  Assets
                </Link>
              </div>
              {reference.isError ? (
                <p className="px-3 py-4 text-sm text-destructive">
                  Service health could not be loaded.
                </p>
              ) : serviceHealth.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No services are registered.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {serviceHealth.map((service) => (
                    <li
                      key={service.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <p className="text-sm font-medium text-foreground">{service.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {service.open} open · {service.hurt} breached
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {roles.includes("admin") ? (
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold text-foreground">Integrate your stack</h2>
                  <Link to="/integrations" className="text-xs underline underline-offset-4">
                    How they connect
                  </Link>
                </div>
                {integrations.isPending ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Checking platform tools…
                  </p>
                ) : integrations.isError ? (
                  <p className="px-3 py-4 text-sm text-destructive">
                    Platform tools could not be checked.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(integrations.data?.tools ?? []).map((tool) => (
                      <li key={tool.name} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-foreground">{tool.name}</p>
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {tool.state === "up"
                              ? "Reachable"
                              : tool.state === "absent"
                                ? "Not installed"
                                : "Unreachable"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{tool.kind}</p>
                        {tool.url ? (
                          <a
                            href={tool.url}
                            className="mt-1 block truncate font-mono text-xs text-primary underline underline-offset-4"
                          >
                            {tool.url.replace("https://", "")}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <h2 className="text-sm font-semibold text-foreground">Knowledge</h2>
                <Link to="/knowledge" className="text-xs underline underline-offset-4">
                  Open knowledge
                </Link>
              </div>
              {reference.isPending ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Loading articles…</p>
              ) : reference.isError ? (
                <p className="px-3 py-4 text-sm text-destructive">Knowledge could not be loaded.</p>
              ) : articles.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No articles yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {articles.map((article) => (
                    <li key={article.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/knowledge"
                          search={{ record: article.id }}
                          className="font-mono text-xs text-primary underline underline-offset-4"
                        >
                          {article.number}
                        </Link>
                        <span className="text-xs text-muted-foreground">{article.category}</span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-foreground">{article.title}</p>
                      {article.summary ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {article.summary}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <h2 className="text-sm font-semibold text-foreground">Service catalogue</h2>
                <Link to="/catalog" className="text-xs underline underline-offset-4">
                  Open catalogue
                </Link>
              </div>
              {reference.isError ? (
                <p className="px-3 py-4 text-sm text-destructive">
                  The catalogue could not be loaded.
                </p>
              ) : catalog.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No catalogue items.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {catalog.map((item) => (
                    <li key={item.id} className="px-3 py-2">
                      <p className="text-xs text-muted-foreground">{item.category}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{item.name}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <h2 className="text-sm font-semibold text-foreground">Assets and CMDB</h2>
                <Link to="/assets" className="text-xs underline underline-offset-4">
                  Open assets
                </Link>
              </div>
              {reference.isError ? (
                <p className="px-3 py-4 text-sm text-destructive">
                  Configuration items could not be loaded.
                </p>
              ) : assets.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No configuration items.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {assets.map((asset) => (
                    <li key={asset.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/assets"
                          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {asset.name}
                        </Link>
                        <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                          {asset.ci_class}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {asset.environment} · {asset.status}
                        {asset.asset_tag ? ` · ${asset.asset_tag}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
