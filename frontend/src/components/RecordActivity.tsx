import { useRecordActivity, type SlaTarget, type TicketType } from "@/api/insights";
import { formatDateTime, humanize } from "@/lib/format";
import { elapsedLabel } from "@/lib/insights";
import { Badge, Panel, StateMessage, type Tone } from "./ui";

const SLA_TONE: Record<string, Tone> = {
  Met: "good",
  Running: "info",
  Paused: "warn",
  Breached: "bad",
  "Breached · paused": "bad",
  Cancelled: "muted",
  "Completion time unavailable": "muted",
};

/** SLA targets and the response timeline, built from recorded audit snapshots only. */
export function RecordActivity({ orgId, recordType, recordId }: { orgId: string; recordType: TicketType; recordId: string }) {
  const activity = useRecordActivity(orgId, recordType, recordId);

  return (
    <Panel className="grid gap-4 p-4">
      <h2 className="text-sm font-semibold">Service targets and history</h2>
      {activity.isPending ? (
        <StateMessage kind="loading">Loading history…</StateMessage>
      ) : activity.isError ? (
        <StateMessage kind="error">{activity.error.message}</StateMessage>
      ) : (
        <>
          {activity.data.slas.length > 0 && (
            <ul className="grid gap-2">
              {activity.data.slas.map((sla) => (
                <SlaRow key={sla.id} sla={sla} />
              ))}
            </ul>
          )}
          <ol className="grid gap-3 border-l border-border pl-4">
            {activity.data.timeline.map((entry) => (
              <li key={entry.id} className="relative text-sm">
                <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                <p className="font-medium">
                  {entry.label}
                  {entry.personName ? ` · ${entry.personName}` : ""}
                  {entry.groupName ? ` · ${entry.groupName}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.at)}
                  {entry.actorName ? ` by ${entry.actorName}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}

function SlaRow({ sla }: { sla: SlaTarget }) {
  const late = sla.overdueMs !== null && sla.overdueMs > 0;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="font-medium">{humanize(sla.target_type)} target</span>
      <Badge tone={SLA_TONE[sla.state] ?? "neutral"}>{sla.state}</Badge>
      <span className="text-xs text-muted-foreground">due {formatDateTime(sla.due_at)}</span>
      {late && <span className="text-xs font-medium text-destructive">{elapsedLabel(sla.overdueMs ?? 0)} late</span>}
      {sla.completedAt && <span className="text-xs text-muted-foreground">· completed {formatDateTime(sla.completedAt)}</span>}
    </li>
  );
}
