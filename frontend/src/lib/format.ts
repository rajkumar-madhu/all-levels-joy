const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTime.format(date) : "—";
}

const PRIORITY_LABELS: Record<number, string> = {
  1: "P1 Critical",
  2: "P2 High",
  3: "P3 Moderate",
  4: "P4 Low",
};

/** Same labels as the existing app's priorityLabel (src/lib/itsm-shared.ts). */
export function priorityLabel(priority: number | null | undefined): string {
  return (priority && PRIORITY_LABELS[priority]) || "P5 Planning";
}

export const ROLE_LABELS: Record<string, string> = {
  requester: "Requester",
  service_desk: "Service desk",
  fulfiller: "Engineer",
  change_manager: "Change manager",
  cab_member: "CAB member",
  cmdb_manager: "CMDB owner",
  manager: "Manager",
  admin: "Administrator",
};

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Time left until a due date, or how long it is overdue. */
export function dueIn(value: string | null | undefined, now: number = Date.now()): { label: string; overdue: boolean } {
  if (!value) return { label: "No target", overdue: false };
  const diff = new Date(value).getTime() - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const span = minutes < 60 ? `${minutes}m` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return diff >= 0 ? { label: `${span} left`, overdue: false } : { label: `${span} overdue`, overdue: true };
}

/** "in 12m" / "5m ago", for timelines and update deadlines. */
export function relativeTime(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return "—";
  const diff = new Date(value).getTime() - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const span = minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  if (span === "now") return "just now";
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

/** Only http(s) links are rendered as links; anything else is shown as text. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
