import type { IncidentState } from "@/api/types";

// Same transitions as the API and the validate_incident_workflow trigger; used to offer only valid moves.
export const INCIDENT_TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  new: ["open", "in_progress", "pending", "resolved", "cancelled"],
  open: ["in_progress", "pending", "resolved", "cancelled"],
  in_progress: ["open", "pending", "resolved", "cancelled"],
  pending: ["open", "in_progress", "resolved", "cancelled"],
  resolved: ["closed", "open"],
  closed: ["open"],
  cancelled: [],
};

export const HOLD_REASONS: Record<string, string> = {
  awaiting_caller: "Awaiting caller",
  awaiting_vendor: "Awaiting vendor",
  awaiting_change: "Awaiting change",
  awaiting_problem: "Awaiting problem",
};

export const CLOSE_CODES: Record<string, string> = {
  solved_permanently: "Solved (permanently)",
  solved_workaround: "Solved (workaround)",
  solved_remotely: "Solved (remotely)",
  not_solved: "Not solved (closed)",
  duplicate: "Duplicate",
};

// Same categories as the existing app (src/lib/itsm-shared.ts INCIDENT_CATEGORIES).
export const INCIDENT_CATEGORIES: { value: string; label: string; subcategories: string[] }[] = [
  { value: "network", label: "Network", subcategories: ["VPN", "Wi-Fi", "DNS", "Firewall"] },
  { value: "hardware", label: "Hardware", subcategories: ["Laptop", "Printer", "Server", "Peripheral"] },
  { value: "software", label: "Software", subcategories: ["Email", "Desktop app", "SaaS", "Operating system"] },
  { value: "database", label: "Database", subcategories: ["Performance", "Availability", "Backup"] },
  { value: "inquiry", label: "Inquiry / help", subcategories: ["How to", "Access", "Licensing"] },
];

export const INCIDENT_UPDATE_ROLES = ["service_desk", "fulfiller", "manager", "admin"];
