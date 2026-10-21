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

export const INCIDENT_UPDATE_ROLES = ["service_desk", "fulfiller", "manager", "admin"];
