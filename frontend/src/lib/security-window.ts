/** Convert a datetime-local selection where the user selected it, never on the server. */
export function localWindowTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid window date and time.");
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) || date.getFullYear() !== year ||
    date.getMonth() + 1 !== month || date.getDate() !== day ||
    date.getHours() !== hour || date.getMinutes() !== minute
  ) {
    throw new Error("That local time does not exist. Choose another window time.");
  }
  return date.toISOString();
}

export function securityWindowPayload(start: string, end: string) {
  const windowStart = localWindowTimeToIso(start);
  const windowEnd = localWindowTimeToIso(end);
  if (Date.parse(windowEnd) <= Date.parse(windowStart)) {
    throw new Error("The fix window must end after it starts.");
  }
  return { action: "schedule" as const, windowStart, windowEnd };
}

export function windowTimeToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}