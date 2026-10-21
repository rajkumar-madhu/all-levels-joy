import { Link } from "react-router";
import { useSlaOverview } from "@/api/insights";
import { IncidentStateBadge, PriorityBadge } from "@/components/badges";
import { Badge, PageHeader, Panel, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, relativeTime } from "@/lib/format";

export function SlaPage() {
  const workspace = useWorkspace();
  const sla = useSlaOverview(workspace.id);

  return (
    <>
      <PageHeader
        eyebrow="ITSM"
        title="SLA performance"
        description={
          workspace.is_staff
            ? "Deadline health for every team across open requests and incidents."
            : "Deadline health for the requests and incidents you have raised."
        }
      />
      {sla.isPending ? (
        <StateMessage kind="loading">Loading service targets…</StateMessage>
      ) : sla.isError ? (
        <StateMessage kind="error">{sla.error.message}</StateMessage>
      ) : (
        <>
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[40rem]">
              <thead>
                <tr>
                  <th className={th}>Team</th>
                  <th className={th}>Open requests</th>
                  <th className={th}>Open incidents</th>
                  <th className={th}>Due within 24h</th>
                  <th className={th}>Breached</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sla.data.teams.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                      No open work with deadlines right now.
                    </td>
                  </tr>
                ) : (
                  sla.data.teams.map((row) => (
                    <tr key={row.groupId ?? "none"} className="hover:bg-accent">
                      <td className="px-4 py-2.5 font-medium">{row.team}</td>
                      <td className="px-4 py-2.5 tabular-nums">{row.openRequests}</td>
                      <td className="px-4 py-2.5 tabular-nums">{row.openIncidents}</td>
                      <td className="px-4 py-2.5 text-warning tabular-nums">{row.dueSoon}</td>
                      <td className="px-4 py-2.5 font-semibold text-destructive tabular-nums">{row.breached}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Panel>

          <Panel>
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Breached now</h2>
            {sla.data.breached.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Nothing is past its deadline.</p>
            ) : (
              <ul className="divide-y divide-border">
                {sla.data.breached.map((t) => (
                  <li key={`${t.recordType}-${t.id}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-mono text-xs text-primary underline" to={`/${t.recordType}s/${t.id}`}>
                        {t.number}
                      </Link>
                      <PriorityBadge priority={t.priority} />
                      <IncidentStateBadge state={t.state} />
                      <Badge tone="bad">Overdue {relativeTime(t.dueAt)}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{t.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.team} · was due {formatDateTime(t.dueAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
