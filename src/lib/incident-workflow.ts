import { z } from "zod";
import type { Database } from "../integrations/supabase/types";
import { CLOSE_CODES, HOLD_REASONS, type AppRole, type RecordState } from "./itsm-shared";

type Incident = Database["public"]["Tables"]["incidents"]["Row"];
type IncidentUpdate = Database["public"]["Tables"]["incidents"]["Update"];

const TRANSITIONS: Record<RecordState, readonly RecordState[]> = {
  new: ["open", "in_progress", "pending", "resolved", "cancelled"],
  open: ["in_progress", "pending", "resolved", "cancelled"],
  in_progress: ["open", "pending", "resolved", "cancelled"],
  pending: ["open", "in_progress", "resolved", "cancelled"],
  resolved: ["closed", "open"],
  closed: ["open"],
  cancelled: [],
};

export function allowedIncidentTransitions(state: RecordState): readonly RecordState[] {
  return TRANSITIONS[state];
}

export function canManageIncidents(roles: readonly AppRole[]): boolean {
  return roles.some((role) => ["service_desk", "fulfiller", "manager", "admin"].includes(role));
}

export const incidentUpdateSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  state: z
    .enum(["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"])
    .optional(),
  assignToMe: z.boolean().optional(),
  groupId: z.string().uuid().nullish(),
  impact: z.number().int().min(1).max(3).optional(),
  urgency: z.number().int().min(1).max(3).optional(),
  resolutionNotes: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(40).nullish(),
  subcategory: z.string().trim().max(60).nullish(),
  onHoldReason: z.string().trim().max(40).nullish(),
  closeCode: z.string().trim().max(40).nullish(),
});

export type IncidentWorkflowInput = z.infer<typeof incidentUpdateSchema>;
export type IncidentWorkflowCurrent = Pick<
  Incident,
  | "state"
  | "updated_at"
  | "first_responded_at"
  | "reopen_count"
  | "resolved_at"
  | "resolution_notes"
  | "close_code"
  | "on_hold_reason"
>;

export const INCIDENT_CONFLICT_MESSAGE =
  "This incident changed after you opened it. Refresh the incident and review the latest values before saving.";

/** Build only supported changes; server reads and the final write both check the version. */
export function buildIncidentWorkflowPatch(
  current: IncidentWorkflowCurrent,
  input: IncidentWorkflowInput,
  actorId: string,
  now = new Date().toISOString(),
): IncidentUpdate {
  if (current.updated_at !== input.expectedUpdatedAt) throw new Error(INCIDENT_CONFLICT_MESSAGE);
  const nextState = input.state ?? current.state;
  const changingState = nextState !== current.state;
  if (changingState && !allowedIncidentTransitions(current.state).includes(nextState)) {
    throw new Error(`Incident cannot move from ${current.state} to ${nextState}.`);
  }

  const patch: IncidentUpdate = {};
  if (input.state !== undefined) patch.state = input.state;
  if (input.assignToMe) patch.assignee_id = actorId;
  if (input.groupId !== undefined) patch.group_id = input.groupId;
  if (input.impact !== undefined) patch.impact = input.impact;
  if (input.urgency !== undefined) patch.urgency = input.urgency;
  if (input.category !== undefined) patch.category = input.category?.trim() || null;
  if (input.subcategory !== undefined) patch.subcategory = input.subcategory?.trim() || null;
  if (input.resolutionNotes !== undefined) patch.resolution_notes = input.resolutionNotes.trim();
  if (input.closeCode !== undefined) patch.close_code = input.closeCode?.trim() || null;
  if (input.onHoldReason !== undefined) patch.on_hold_reason = input.onHoldReason?.trim() || null;

  if (nextState === "pending" && (changingState || input.onHoldReason !== undefined)) {
    const holdReason = patch.on_hold_reason ?? current.on_hold_reason;
    if (!holdReason || !Object.hasOwn(HOLD_REASONS, holdReason) || patch.on_hold_reason === null) {
      throw new Error("Select a valid hold reason before placing this incident on hold.");
    }
  }
  if (nextState !== "pending" && (changingState || input.onHoldReason !== undefined)) {
    patch.on_hold_reason = null;
  }

  const reopening =
    changingState && nextState === "open" && ["resolved", "closed"].includes(current.state);
  if (reopening) {
    patch.resolved_at = null;
    patch.resolution_notes = null;
    patch.close_code = null;
    patch.reopen_count = current.reopen_count + 1;
  } else if (
    ["resolved", "closed"].includes(nextState) &&
    (changingState || input.resolutionNotes !== undefined || input.closeCode !== undefined)
  ) {
    const notes =
      patch.resolution_notes !== undefined ? patch.resolution_notes : current.resolution_notes;
    const closeCode = patch.close_code !== undefined ? patch.close_code : current.close_code;
    if (!notes?.trim())
      throw new Error("Add resolution notes before resolving or closing this incident.");
    if (!closeCode || !Object.hasOwn(CLOSE_CODES, closeCode)) {
      throw new Error("Select a valid close code before resolving or closing this incident.");
    }
    if (changingState && nextState === "resolved") patch.resolved_at = now;
    // Closing and later metadata edits must retain the original SLA completion timestamp.
    if (nextState === "closed" && !current.resolved_at) {
      throw new Error(
        "This incident has no resolution timestamp. Reopen and resolve it before closing.",
      );
    }
  }

  if (
    !current.first_responded_at &&
    (input.assignToMe ||
      (changingState && ["open", "in_progress", "pending", "resolved"].includes(nextState)))
  ) {
    patch.first_responded_at = now;
  }
  return patch;
}

/** Resolution records without an SLA target do not belong in either side of the ratio. */
export function incidentSlaAttainment(
  rows: readonly { resolved_at: string | null; sla_due_at: string | null }[],
): number | null {
  const measured = rows.filter((row) => row.resolved_at && row.sla_due_at);
  if (!measured.length) return null;
  const met = measured.filter((row) => Date.parse(row.resolved_at!) <= Date.parse(row.sla_due_at!));
  return (met.length / measured.length) * 100;
}
