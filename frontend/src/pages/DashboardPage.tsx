import { Link } from "react-router";
import { useIncidents, useSecurityBoard } from "@/api/hooks";
import { PriorityBadge } from "@/components/badges";
import { PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn } from "@/lib/format";

const OPEN_STATES = "new,open,in_progress,pending";

export function DashboardPage() {
  const workspace = useWorkspace();
  const incidents = useIncidents(workspace.id, { state: OPEN_STATES });
  const security = useSecurityBoard(workspace.id, workspace.is_staff);
  const open = incidents.data ?? [];
  const breached = open.filter((i) => dueIn(i.sla_due_at).overdue);
  const activeFindings = (security.data?.findings ?? []).filter((f) => !["closed", "cancelled", "risk_accepted"].includes(f.state));

  const tiles = [
    { label: workspace.is_staff ? "Open incidents" : "Your open tickets", value: open.length, to: "/incidents" },
    { label: "Past SLA target", value: breached.length, to: "/incidents", alert: breached.length > 0 },
    ...(workspace.is_staff
      ? [{ label: "Active security findings", value: activeFindings.length, to: "/security", alert: false }]
      : []),
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={`What needs attention in ${workspace.name}.`} />
      {incidents.isPending ? (
        <StateMessage kind="loading">Loading…</StateMessage>
      ) : incidents.isError ? (
        <StateMessage kind="error">{incidents.error.message}</StateMessage>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map((t) => (
              <Link key={t.label} to={t.to}>
                <Panel className="p-4 hover:border-brand-500">
                  <p className="text-sm text-slate-600 dark:text-slate-400">{t.label}</p>
                  <p className={`mt-1 text-3xl font-semibold tabular-nums ${t.alert ? "text-red-600 dark:text-red-400" : ""}`}>{t.value}</p>
                </Panel>
              </Link>
            ))}
          </div>
          <Panel>
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold dark:border-slate-800">Closest to their SLA target</h2>
            {open.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-600 dark:text-slate-400">No open incidents.</p>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {[...open]
                  .sort((a, b) => (a.sla_due_at ?? "9").localeCompare(b.sla_due_at ?? "9"))
                  .slice(0, 6)
                  .map((i) => {
                    const due = dueIn(i.sla_due_at);
                    return (
                      <li key={i.id}>
                        <Link to={`/incidents/${i.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <span className="font-mono text-xs text-slate-500">{i.number}</span>
                          <span className="min-w-0 flex-1 truncate">{i.title}</span>
                          <PriorityBadge priority={i.priority} />
                          <span className={`w-24 text-right tabular-nums ${due.overdue ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
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
