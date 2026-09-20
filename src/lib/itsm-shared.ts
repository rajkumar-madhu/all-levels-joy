export const DEMO_ORG_ID = "10000000-0000-0000-0000-000000000001";

export type AppRole =
  | "requester"
  | "service_desk"
  | "fulfiller"
  | "change_manager"
  | "cab_member"
  | "cmdb_manager"
  | "manager"
  | "admin";

export type RecordState =
  | "new"
  | "open"
  | "in_progress"
  | "pending"
  | "resolved"
  | "closed"
  | "cancelled";

export const RECORD_STATES: RecordState[] = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
  "cancelled",
];

export const STATE_LABELS: Record<RecordState, string> = {
  new: "New",
  open: "Open",
  in_progress: "In progress",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  requester: "Requester",
  service_desk: "Service desk",
  fulfiller: "Engineer",
  change_manager: "Change manager",
  cab_member: "CAB member",
  cmdb_manager: "CMDB owner",
  manager: "Manager",
  admin: "Administrator",
};

export const IMPACT_URGENCY_LABELS: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

export function priorityLabel(priority: number | null | undefined) {
  switch (priority) {
    case 1:
      return "P1 Critical";
    case 2:
      return "P2 High";
    case 3:
      return "P3 Moderate";
    case 4:
      return "P4 Low";
    default:
      return "P5 Planning";
  }
}

export type SlaState = "none" | "breached" | "at_risk" | "on_track" | "completed";

export function slaState(dueAt: string | null, resolvedAt: string | null): SlaState {
  if (resolvedAt) return "completed";
  if (!dueAt) return "none";
  const remainingMinutes = (new Date(dueAt).getTime() - Date.now()) / 60000;
  if (remainingMinutes < 0) return "breached";
  if (remainingMinutes < 60) return "at_risk";
  return "on_track";
}

export const SLA_LABELS: Record<SlaState, string> = {
  none: "No target",
  breached: "Breached",
  at_risk: "At risk",
  on_track: "On track",
  completed: "Met",
};

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const diffMinutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Math.abs(diffMinutes) < 60) return `${Math.abs(diffMinutes)}m ${diffMinutes >= 0 ? "ago" : "ahead"}`;
  const hours = Math.round(diffMinutes / 60);
  if (Math.abs(hours) < 48) return `${Math.abs(hours)}h ${hours >= 0 ? "ago" : "ahead"}`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${days >= 0 ? "ago" : "ahead"}`;
}

export const MANAGEMENT_ROLES: AppRole[] = [
  "service_desk",
  "fulfiller",
  "change_manager",
  "cab_member",
  "cmdb_manager",
  "manager",
  "admin",
];

export function canManage(roles: AppRole[]) {
  return roles.some((role) => MANAGEMENT_ROLES.includes(role));
}

export function safeRedirect(path: string | undefined | null) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/dashboard";
  return path;
}

export const INCIDENT_CATEGORIES: { value: string; label: string; subcategories: string[] }[] = [
  { value: "network", label: "Network", subcategories: ["VPN", "Wi-Fi", "DNS", "Firewall"] },
  { value: "hardware", label: "Hardware", subcategories: ["Laptop", "Printer", "Server", "Peripheral"] },
  { value: "software", label: "Software", subcategories: ["Email", "Desktop app", "SaaS", "Operating system"] },
  { value: "database", label: "Database", subcategories: ["Performance", "Availability", "Backup"] },
  { value: "inquiry", label: "Inquiry / help", subcategories: ["How to", "Access", "Licensing"] },
];

export const CONTACT_TYPES: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  self_service: "Self-service",
  chat: "Chat",
  walk_up: "Walk-up",
  monitoring: "Monitoring event",
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

export function labelOf(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—";
  return map[value] ?? value.replace(/_/g, " ");
}

export function categoryLabel(value: string | null | undefined) {
  if (!value) return "—";
  return INCIDENT_CATEGORIES.find((item) => item.value === value)?.label ?? value;
}

export function formatHours(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1) return `${Math.round(value * 60)}m`;
  if (value < 48) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

export const BRIDGE_STATES = [
  "declared",
  "investigating",
  "mitigating",
  "monitoring",
  "resolved",
] as const;

export type BridgeState = (typeof BRIDGE_STATES)[number];

export const BRIDGE_STATE_LABELS: Record<BridgeState, string> = {
  declared: "Declared",
  investigating: "Investigating",
  mitigating: "Mitigating",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export const SEVERITY_LABELS: Record<number, string> = {
  1: "Sev 1 — critical outage",
  2: "Sev 2 — major degradation",
  3: "Sev 3 — limited impact",
};

export const UPDATE_TYPE_LABELS: Record<string, string> = {
  declaration: "Declaration",
  status: "Status",
  action: "Action",
  escalation: "Escalation",
  comms: "Communication",
  resolution: "Resolution",
};

export const AUDIENCE_LABELS: Record<string, string> = {
  internal: "Internal",
  customer: "Customer",
  executive: "Executive",
};

export const PROBLEM_ROLES_ALLOWED = [
  "service_desk",
  "fulfiller",
  "manager",
  "admin",
  "change_manager",
] as const;

export function canRunProblems(roles: AppRole[]) {
  return roles.some((role) => (PROBLEM_ROLES_ALLOWED as readonly string[]).includes(role));
}
