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
