import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PriorityBadge, StateBadge } from "@/components/status-badge";
import { formatDateTime, relativeTime, slaState } from "@/lib/itsm-shared";
import { referenceQuery } from "@/lib/workspace-queries";

export const Route = createFileRoute("/_authenticated/sla")({
  head: () => ({
    meta: [
      { title: "SLA dashboard — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Per-team view of open requests and incidents, deadlines approaching, and breached targets.",
      },
      { property: "og:title", content: "SLA dashboard — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Team-by-team deadline health across requests and incidents.",
      },
    ],
  }),
  component: SlaDashboard,
});

const ACTIVE_STATES = ["new", "open", "in_progress", "pending"];
const DAY_MS = 86_400_000;

type TeamRow = {
  groupId: string | null;
  team: string;
  openRequests: number;
  openIncidents: number;
  dueSoon: number;
  breached: number;
};

function SlaDashboard() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const data = workspace.data;
  const groups = reference.data?.groups ?? [];
  const now = Date.now();

  const requests = (data?.requests ?? []).filter((r) => ACTIVE_STATES.includes(r.state));
  const incidents = (data?.incidents ?? []).filter((i) => ACTIVE_STATES.includes(i.state));

  const rows = new Map<string, TeamRow>();
  const rowFor = (groupId: string | null) => {
    const key = groupId ?? "none";
    const existing = rows.get(key);
    if (existing) return existing;
    const row: TeamRow = {
      groupId,
      team: groups.find((g) => g.id === groupId)?.name ?? "Unassigned team",
      openRequests: 0,
      openIncidents: 0,
      dueSoon: 0,
      breached: 0,
    };
    rows.set(key, row);
    return row;
  };

  for (const r of requests) {
    const row = rowFor(r.group_id);
    row.openRequests++;
    const due = r.due_at ? Date.parse(r.due_at) : null;
    if (due !== null && Number.isFinite(due)) {
      if (due < now) row.breached++;
      else if (due - now <= DAY_MS) row.dueSoon++;
    }
  }
  for (const i of incidents) {
    const row = rowFor(i.group_id);
    row.openIncidents++;
    const state = slaState(i.sla_due_at, i.resolved_at, now);
    if (state === "breached") row.breached++;
    else if (i.sla_due_at) {
      const due = Date.parse(i.sla_due_at);
      if (Number.isFinite(due) && due >= now && due - now <= DAY_MS) row.dueSoon++;
    }
  }

  const teamRows = [...rows.values()].sort(
    (a, b) => b.breached - a.breached || b.dueSoon - a.dueSoon || a.team.localeCompare(b.team),
  );

  const breachedTickets = [
    ...requests
      .filter((r) => r.due_at && Date.parse(r.due_at) < now)
      .map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        state: r.state,
        priority: r.priority,
        dueAt: r.due_at!,
        team: groups.find((g) => g.id === r.group_id)?.name ?? "Unassigned team",
        to: "/requests" as const,
      })),
    ...incidents
      .filter((i) => slaState(i.sla_due_at, i.resolved_at, now) === "breached")
      .map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state,
        priority: i.priority,
        dueAt: i.sla_due_at!,
        team: groups.find((g) => g.id === i.group_id)?.name ?? "Unassigned team",
        to: "/incidents" as const,
      })),
  ].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Operations"
        title="SLA dashboard"
        description="Deadline health for every team across open requests and incidents."
      />

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
          <section className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Team</th>
                  <th className="px-4 py-2.5 font-semibold">Open requests</th>
                  <th className="px-4 py-2.5 font-semibold">Open incidents</th>
                  <th className="px-4 py-2.5 font-semibold">Due within 24h</th>
                  <th className="px-4 py-2.5 font-semibold">Breached</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                      No open work with deadlines right now.
                    </td>
                  </tr>
                ) : (
                  teamRows.map((row) => (
                    <tr key={row.groupId ?? "none"} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium text-foreground">{row.team}</td>
                      <td className="px-4 py-2.5">
                        <Link
                          to="/requests"
                          search={
                            row.groupId
                              ? { team: row.groupId }
                              : { team: undefined }
                          }
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {row.openRequests}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          to="/incidents"
                          search={
                            row.groupId
                              ? { group: row.groupId }
                              : { group: "unassigned" }
                          }
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {row.openIncidents}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-warning">{row.dueSoon}</td>
                      <td className="px-4 py-2.5 font-semibold text-destructive">
                        {row.breached}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="mt-8 rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Breached now</h2>
            </div>
            {breachedTickets.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing is past its deadline. Nice work.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {breachedTickets.map((ticket) => (
                  <li key={`${ticket.to}-${ticket.id}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={ticket.to}
                        search={{ record: ticket.id }}
                        className="font-mono text-xs text-primary underline underline-offset-4"
                      >
                        {ticket.number}
                      </Link>
                      <PriorityBadge priority={ticket.priority} />
                      <StateBadge state={ticket.state} />
                      <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                        Overdue {relativeTime(ticket.dueAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-foreground">{ticket.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ticket.team} · was due {formatDateTime(ticket.dueAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
