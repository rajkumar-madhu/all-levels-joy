import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { referenceQuery } from "@/lib/workspace-queries";
import { formatDateTime } from "@/lib/itsm-shared";
import { elapsedLabel, ticketTimeline, ticketSlaDetails, type TicketSnapshot, type HistoryEvent, type TicketSla } from "@/lib/ticket-timeline";

export function TicketResponseTimeline({ ticket, audit, slas }: { ticket: TicketSnapshot; audit: HistoryEvent[]; slas: TicketSla[] }) {
  const reference = useQuery(referenceQuery());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const timeline = ticketTimeline(ticket, audit);
  const person = (id?: string | null) => reference.data?.people.find(p => p.id === id)?.display_name ?? "Workspace colleague";
  return <div className="space-y-6">
    <section aria-label="Response timeline">
      <h3 className="text-sm font-semibold text-foreground">Response timeline</h3>
      <ol className="mt-3 border-l border-border pl-4 space-y-4">
        {timeline.map(entry => <li key={entry.id} className="text-xs">
          <p className="font-medium text-foreground">{entry.label}{entry.personId ? ` · ${person(entry.personId)}` : ""}{entry.groupId ? ` · ${reference.data?.groups.find(g => g.id === entry.groupId)?.name ?? "Assignment team"}` : ""}</p>
          <time dateTime={entry.at} className="mt-1 block text-muted-foreground">{formatDateTime(entry.at)}</time>
          {entry.actorId ? <p className="mt-1 text-muted-foreground">By {person(entry.actorId)}</p> : null}
        </li>)}
      </ol>
      {ticket.assignee_id && !timeline.some(e => e.personId) ? <p className="mt-3 text-xs text-muted-foreground">Assigned to {person(ticket.assignee_id)} · Assignment time not recorded.</p> : null}
      {ticket.state === "closed" && !timeline.some(e => e.label === "Closed") ? <p className="mt-3 text-xs text-muted-foreground">Closed · Closure time not recorded.</p> : null}
    </section>
    <section aria-label="SLA breach details">
      <h3 className="text-sm font-semibold text-foreground">SLA breach details</h3>
      {slas.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No SLA targets recorded for this ticket.</p> : <ul className="mt-3 divide-y divide-border">
        {slas.map(sla => {
          const detail = ticketSlaDetails(sla, timeline, now, ticket);
          const breached = detail.state.startsWith("Breached");
          const Icon = breached ? AlertTriangle : detail.state === "Met" ? CheckCircle2 : Clock;
          return <li key={sla.id} className="py-3 first:pt-0 text-xs space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><span className="capitalize font-medium text-foreground">{sla.target_type} target</span><span className={breached ? "flex items-center gap-1 text-destructive" : "flex items-center gap-1 text-muted-foreground"}><Icon className="size-3.5" />{detail.state}</span></div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
              <dt>Started</dt><dd className="text-foreground">{formatDateTime(sla.started_at)}</dd>
              <dt>Deadline</dt><dd className="text-foreground">{formatDateTime(sla.due_at)}</dd>
              {detail.completedAt ? <><dt>Completed</dt><dd className="text-foreground">{formatDateTime(detail.completedAt)}</dd></> : null}
              {detail.paused ? <><dt>Paused since</dt><dd className="text-foreground">{formatDateTime(sla.paused_at)}</dd></> : null}
              {breached && detail.overdueMs ? <><dt>Breach began</dt><dd className="text-destructive">{formatDateTime(sla.due_at)}</dd><dt>Overdue by</dt><dd className="text-destructive">{elapsedLabel(detail.overdueMs)}{detail.stopped ? " at completion" : detail.paused ? " at pause" : ""}</dd></> : null}
            </dl>
          </li>;
        })}
      </ul>}
    </section>
  </div>;
}