export const STATUS_REFRESH_MS = 30_000;
export type ServiceState = "operational" | "degraded" | "outage" | "maintenance" | "unknown";
export type PublicService = { name: string; status: string; updated_at: string | null };

export function serviceState(value: string): ServiceState {
  switch (value.toLowerCase()) {
    case "operational":
      return "operational";
    case "degraded":
      return "degraded";
    case "outage":
    case "down":
      return "outage";
    case "maintenance":
      return "maintenance";
    default:
      return "unknown";
  }
}

export function visibleServices(records: PublicService[]): PublicService[] {
  const services = [...records];
  for (const name of ["VPN", "Payments", "ERP"]) {
    if (!services.some((service) => service.name.toLowerCase().includes(name.toLowerCase()))) {
      services.push({ name, status: "unknown", updated_at: null });
    }
  }
  return services.sort((a, b) => a.name.localeCompare(b.name));
}

export function overallServiceState(services: PublicService[]): ServiceState {
  const states = services.map((s) => serviceState(s.status));
  for (const state of ["outage", "degraded", "maintenance", "unknown"] as const) {
    if (states.includes(state)) return state;
  }
  return states.length ? "operational" : "unknown";
}
