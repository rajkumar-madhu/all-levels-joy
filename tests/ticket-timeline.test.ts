import { describe, expect, test } from "bun:test";
import { ticketTimeline, ticketSlaDetails, ticketSlaTargets, type HistoryEvent, type TicketSla } from "../src/lib/ticket-timeline";
const ticket = { created_at: "2026-10-14T08:00:00Z", state: "open" };
const event = (id: string, at: string, before: unknown, after: unknown): HistoryEvent => ({ id, created_at: at, source: "database", action: "updated", actor_id: "staff", before_values: before, after_values: after });
const sla: TicketSla = { id: "sla", target_type: "resolution", started_at: ticket.created_at, due_at: "2026-10-14T10:00:00Z", completed_at: null, paused_at: null, status: "running" };
describe("ticket response history", () => {
  test("legacy incidents still show their recorded SLA deadline", () => {
    expect(ticketSlaTargets({ ...ticket, sla_due_at: "2026-10-14T10:00:00Z" }, [])[0]?.due_at).toBe("2026-10-14T10:00:00Z");
  });
  test("opened, assigned and closed use exact recorded times", () => {
    const timeline = ticketTimeline(ticket, [event("a", "2026-10-14T09:00:00Z", { assignee_id: null }, { assignee_id: "staff" }), event("c", "2026-10-14T12:00:00Z", { state: "resolved" }, { state: "closed" })]);
    expect(timeline.map(e => [e.label, e.at])).toEqual([["Opened", ticket.created_at], ["Assigned", "2026-10-14T09:00:00Z"], ["Closed", "2026-10-14T12:00:00Z"]]);
  });
  test("never invents closure time from record update time", () => {
    expect(ticketTimeline({ ...ticket, state: "closed" }, []).some(e => e.label === "Closed")).toBe(false);
  });
  test("live breach is measured against the deadline", () => {
    const result = ticketSlaDetails(sla, [], Date.parse("2026-10-14T11:30:00Z"), ticket);
    expect(result.state).toBe("Breached"); expect(result.overdueMs).toBe(90 * 60000);
  });
  test("resolution freezes lateness even if stored SLA still says running", () => {
    const result = ticketSlaDetails(sla, [{ id: "r", label: "Resolved", at: "2026-10-14T10:30:00Z" }], Date.parse("2026-10-15T12:00:00Z"), { ...ticket, state: "closed" });
    expect(result.overdueMs).toBe(30 * 60000); expect(result.completedAt).toBe("2026-10-14T10:30:00Z");
  });
  test("paused clock does not accumulate further lateness", () => {
    const result = ticketSlaDetails({ ...sla, status: "paused", paused_at: "2026-10-14T10:15:00Z" }, [], Date.parse("2026-10-15T12:00:00Z"), ticket);
    expect(result.state).toBe("Breached · paused"); expect(result.overdueMs).toBe(15 * 60000);
  });
  test("no breach at the exact deadline", () => {
    expect(ticketSlaDetails(sla, [], Date.parse(sla.due_at), ticket).state).toBe("Running");
  });
});