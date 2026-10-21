const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTime.format(date) : "—";
}

/** Incident priority from impact and urgency (1 = highest), matching the legacy matrix. */
export function priorityLabel(priority: number | null | undefined): string {
  return priority ? `P${priority}` : "—";
}

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
