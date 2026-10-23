export type TicketSnapshot = {
  created_at: string;
  state: string;
  resolved_at?: string | null;
  first_responded_at?: string | null;
  assignee_id?: string | null;
  sla_due_at?: string | null;
  due_at?: string | null;
};
export type HistoryEvent = {
  id: string;
  action: string;
  source: string;
  created_at: string;
  actor_id: string | null;
  before_values: unknown;
  after_values: unknown;
};
export type TimelineEntry = {
  id: string;
  label: string;
  at: string;
  actorId?: string | null;
  personId?: string | null;
  groupId?: string | null;
};
const snapshot = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringValue = (value: unknown) => (typeof value === "string" ? value : null);

export function ticketTimeline(ticket: TicketSnapshot, audit: HistoryEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ id: "opened", label: "Opened", at: ticket.created_at }];
  for (const event of audit) {
    if (event.source !== "database" || !["created", "updated"].includes(event.action)) continue;
    const before = snapshot(event.before_values),
      after = snapshot(event.after_values);
    const add = (suffix: string, label: string, extra = {}) =>
      entries.push({
        id: `${event.id}-${suffix}`,
        label,
        at: event.created_at,
        actorId: event.actor_id,
        ...extra,
      });
    if (
      after["assignee_id"] !== before["assignee_id"] &&
      (after["assignee_id"] || before["assignee_id"])
    )
      add(
        "assigned",
        after["assignee_id"] ? (before["assignee_id"] ? "Reassigned" : "Assigned") : "Unassigned",
        { personId: stringValue(after["assignee_id"]) },
      );
    if (after["group_id"] !== before["group_id"] && (after["group_id"] || before["group_id"]))
      add("team", after["group_id"] ? "Routed to team" : "Team removed", {
        groupId: stringValue(after["group_id"]),
      });
    if (before["state"] && after["state"] !== before["state"]) {
      const labels: Record<string, string> = {
        open: ["resolved", "closed"].includes(String(before["state"]))
          ? "Reopened"
          : "Opened for work",
        in_progress: "Work started",
        pending: "On hold",
        resolved: "Resolved",
        closed: "Closed",
        cancelled: "Cancelled",
        new: "New",
      };
      add("state", labels[String(after["state"])] ?? "Status changed");
    }
  }
  if (ticket.first_responded_at)
    entries.push({ id: "response", label: "First response", at: ticket.first_responded_at });
  if (
    ticket.resolved_at &&
    !entries.some(
      (e) =>
        e.label === "Resolved" &&
        Math.abs(Date.parse(e.at) - Date.parse(ticket.resolved_at ?? "")) < 1000,
    )
  )
    entries.push({ id: "resolved", label: "Resolved", at: ticket.resolved_at });
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export type TicketSla = {
  id: string;
  target_type: string;
  started_at: string;
  due_at: string;
  completed_at: string | null;
  paused_at: string | null;
  status: string;
};
export function ticketSlaTargets(ticket: TicketSnapshot, slas: TicketSla[]): TicketSla[] {
  const due = ticket.sla_due_at ?? ticket.due_at;
  if (slas.length || !due) return slas;
  return [
    {
      id: "record-target",
      target_type: ticket.sla_due_at ? "resolution" : "fulfillment",
      started_at: ticket.created_at,
      due_at: due,
      completed_at: ticket.resolved_at ?? null,
      paused_at: null,
      status: "running",
    },
  ];
}
export function ticketSlaDetails(
  sla: TicketSla,
  timeline: TimelineEntry[],
  now: number,
  ticket: TicketSnapshot,
) {
  const completionLabel = sla.target_type === "response" ? "First response" : "Resolved";
  const completion = timeline.find(
    (e) => e.label === completionLabel && Date.parse(e.at) >= Date.parse(sla.started_at),
  );
  const cancelled = timeline.find(
    (e) => e.label === "Cancelled" && Date.parse(e.at) >= Date.parse(sla.started_at),
  );
  const completedAt = completion?.at ?? sla.completed_at;
  const due = Date.parse(sla.due_at);
  const stopped = Boolean(completedAt) || Boolean(cancelled) || sla.status === "cancelled";
  const paused = !stopped && sla.status === "paused";
  const missingEnd =
    !stopped && !paused && ["resolved", "closed", "cancelled"].includes(ticket.state);
  const end = completedAt
    ? Date.parse(completedAt)
    : cancelled
      ? Date.parse(cancelled.at)
      : paused && sla.paused_at
        ? Date.parse(sla.paused_at)
        : now;
  const overdueMs = missingEnd ? null : Math.max(0, end - due);
  const state =
    cancelled || sla.status === "cancelled"
      ? "Cancelled"
      : missingEnd
        ? "Completion time unavailable"
        : overdueMs && overdueMs > 0
          ? paused
            ? "Breached · paused"
            : "Breached"
          : paused
            ? "Paused"
            : completedAt
              ? "Met"
              : "Running";
  return { state, overdueMs, completedAt, paused, stopped, missingEnd };
}

export function elapsedLabel(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
