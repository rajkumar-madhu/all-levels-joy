// Current IANA names that some ICU builds still list only under an older alias (e.g. Asia/Calcutta).
const CURRENT_NAMES = ["Asia/Kolkata", "Asia/Kathmandu", "Asia/Ho_Chi_Minh", "Asia/Yangon", "Europe/Kyiv", "America/Nuuk"];

/** IANA timezones the browser knows, always including the current value so it is never silently dropped. */
export function timeZones(current?: string | null): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const all = new Set(["UTC", ...zones, ...CURRENT_NAMES]);
  if (current) all.add(current);
  return [...all].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}
