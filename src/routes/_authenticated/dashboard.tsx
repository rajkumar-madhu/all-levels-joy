import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PriorityBadge, SlaBadge, StateBadge } from "@/components/status-badge";
import { ROLE_LABELS, formatDateTime, relativeTime, slaState, type AppRole } from "@/lib/itsm-shared";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Operations dashboard — WeCrew ITSM" },
      {
        name: "description",
        content: "Live view of incident load, SLA exposure, pending approvals, and change schedule.",
      },
      { property: "og:title", content: "Operations dashboard — WeCrew ITSM" },
      { property: "og:description", content: "Incident load, SLA risk, approvals, and change calendar." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const workspace = useWorkspace();
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
  const roles = (data?.roles ?? []) as AppRole[];

  const metrics = [
    { label: "Open incidents", value: openIncidents.length, hint: `${incidents.length} total logged` },
    { label: "SLA breached", value: breached.length, hint: "Needs immediate attention" },
    { label: "SLA at risk", value: atRisk.length, hint: "Due within the hour" },
    { label: "Open requests", value: openRequests.length, hint: "In fulfillment" },
    { label: "Awaiting approval", value: (data?.approvals ?? []).length, hint: "Assigned to you" },
    { label: "Scheduled changes", value: upcomingChanges.length, hint: "Current window" },
  ];

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Operations"
        title={`Good to see you, ${data?.profile?.display_name?.split(" ")[0] ?? "there"}`}
        description="Everything below reflects the records your assigned roles allow you to see."
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
          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-foreground">{metric.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
              </div>
            ))}
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Priority incident queue</h2>
                <Link to="/incidents" className="text-xs underline underline-offset-4">
                  Open queue
                </Link>
              </div>
              {openIncidents.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No open incidents. Nice and quiet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {openIncidents.slice(0, 6).map((incident) => (
                    <li key={incident.id} className="px-4 py-3">
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
                      <p className="mt-1.5 text-sm font-medium text-foreground">{incident.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Logged {relativeTime(incident.created_at)} · Due{" "}
                        {formatDateTime(incident.sla_due_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">Change schedule</h2>
                  <Link to="/changes" className="text-xs underline underline-offset-4">
                    View all
                  </Link>
                </div>
                {upcomingChanges.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">No changes scheduled.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {upcomingChanges.slice(0, 4).map((change) => (
                      <li key={change.id} className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {change.number}
                          </span>
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

              <div className="rounded-lg border border-border bg-card p-4">
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
                <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                  Recent notifications
                </h2>
                <ul className="divide-y divide-border">
                  {(data?.notifications ?? []).slice(0, 5).map((item) => (
                    <li key={item.id} className="px-4 py-3 text-sm">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.body} · {relativeTime(item.created_at)}
                      </p>
                    </li>
                  ))}
                  {(data?.notifications ?? []).length === 0 ? (
                    <li className="px-4 py-6 text-sm text-muted-foreground">Nothing new for you.</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
