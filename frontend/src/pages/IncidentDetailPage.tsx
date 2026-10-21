import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { useIncident } from "@/api/hooks";
import { IncidentStateBadge, PriorityBadge } from "@/components/badges";
import { PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, formatDateTime, humanize } from "@/lib/format";

export function IncidentDetailPage() {
  const workspace = useWorkspace();
  const { incidentId = "" } = useParams();
  const incident = useIncident(workspace.id, incidentId);

  if (incident.isPending) return <StateMessage kind="loading">Loading incident…</StateMessage>;
  if (incident.isError) return <StateMessage kind="error">{incident.error.message}</StateMessage>;
  const i = incident.data;
  const due = dueIn(i.sla_due_at);
  const facts: [string, React.ReactNode][] = [
    ["State", <IncidentStateBadge state={i.state} />],
    ["Priority", <PriorityBadge priority={i.priority} />],
    ["Impact / urgency", `${i.impact} / ${i.urgency}`],
    ["Category", humanize(i.category)],
    ["Raised via", humanize(i.contact_type)],
    ["SLA target", i.sla_due_at ? `${formatDateTime(i.sla_due_at)} (${due.label})` : "—"],
    ["First response", formatDateTime(i.first_responded_at)],
    ["Opened", formatDateTime(i.created_at)],
    ["Resolved", formatDateTime(i.resolved_at)],
  ];

  return (
    <>
      <Link to="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400">
        <ArrowLeft className="size-4" /> Incidents
      </Link>
      <PageHeader title={`${i.number} · ${i.title}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Description</h2>
          <p className="text-sm whitespace-pre-wrap">{i.description || "No description."}</p>
          {i.resolution_notes && (
            <>
              <h2 className="mt-6 mb-2 text-sm font-semibold">Resolution</h2>
              <p className="text-sm whitespace-pre-wrap">{i.resolution_notes}</p>
            </>
          )}
        </Panel>
        <Panel className="p-4">
          <dl className="grid gap-3 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </>
  );
}
