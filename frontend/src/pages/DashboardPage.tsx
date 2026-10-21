import { BadgeCheck, CircleAlert, Inbox, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import { useIncidents, useMyApprovals, useSecurityBoard } from "@/api/hooks";
import { PriorityBadge } from "@/components/badges";
import { PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn } from "@/lib/format";

const OPEN_STATES = "new,open,in_progress,pending";

export function DashboardPage() {
  const workspace = useWorkspace();
  const incidents = useIncidents(workspace.id, { state: OPEN_STATES });
  const security = useSecurityBoard(workspace.id, workspace.is_staff);
  const approvals = useMyApprovals(workspace.id, "requested");
  const open = incidents.data ?? [];
  const breached = open.filter((i) => dueIn(i.sla_due_at).overdue);
  const activeFindings = (security.data?.findings ?? []).filter((f) => !["closed", "cancelled", "risk_accepted"].includes(f.state));

  const tiles: { label: string; caption: string; value: number; to: string; icon: typeof Inbox; alert?: boolean }[] = [
    {
      label: workspace.is_staff ? "Active incidents" : "Your open tickets",
      caption: "Awaiting resolution",
      value: open.length,
      to: "/incidents",
      icon: Inbox,
    },
    {
      label: "Overdue incidents",
      caption: "Resolution target missed",
      value: breached.length,
      to: "/incidents",
      icon: CircleAlert,
      alert: breached.length > 0,
    },
    {
      label: "Waiting for my approval",
      caption: "Requests and changes",
      value: approvals.data?.length ?? 0,
      to: "/approvals",
      icon: BadgeCheck,
    },
    ...(workspace.is_staff
      ? [{ label: "Active security findings", caption: "Open fix plans and exceptions", value: activeFindings.length, to: "/security", icon: ShieldAlert }]
      : []),
  ];

  return (
    <>
      <PageHeader eyebrow="Overview" title="Dashboard" description={`What needs attention in ${workspace.name}.`} />
      {incidents.isPending ? (
        <StateMessage kind="loading">Loading…</StateMessage>
      ) : incidents.isError ? (
        <StateMessage kind="error">{incidents.error.message}</StateMessage>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((t) => (
              <Link key={t.label} to={t.to}>
                <Panel className="h-full p-4 hover:border-primary">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground">{t.label}</p>
                    <t.icon className="size-4 text-muted-foreground" aria-hidden />
                  </div>
                  <p className={`mt-2 text-2xl font-semibold tabular-nums ${t.alert ? "text-destructive" : ""}`}>{t.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t.caption}</p>
                </Panel>
              </Link>
            ))}
          </div>
          <Panel>
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Closest to their SLA target</h2>
            {open.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No open incidents.</p>
            ) : (
              <ul className="divide-y divide-border">
                {[...open]
                  .sort((a, b) => (a.sla_due_at ?? "9").localeCompare(b.sla_due_at ?? "9"))
                  .slice(0, 6)
                  .map((i) => {
                    const due = dueIn(i.sla_due_at);
                    return (
                      <li key={i.id}>
                        <Link to={`/incidents/${i.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent">
                          <span className="font-mono text-xs text-muted-foreground">{i.number}</span>
                          <span className="min-w-0 flex-1 truncate">{i.title}</span>
                          <PriorityBadge priority={i.priority} />
                          <span className={`w-24 text-right tabular-nums ${due.overdue ? "text-destructive" : "text-muted-foreground"}`}>
                            {due.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
