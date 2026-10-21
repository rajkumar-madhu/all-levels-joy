import type { FindingState, IncidentState, Severity } from "@/api/types";
import { humanize, priorityLabel } from "@/lib/format";
import { Badge, type Tone } from "./ui";

// Tones follow the existing StateBadge (src/components/status-badge.tsx).
const incidentTone: Record<IncidentState, Tone> = {
  new: "neutral",
  open: "info",
  in_progress: "info",
  pending: "warn",
  resolved: "good",
  closed: "muted",
  cancelled: "muted",
};

export const IncidentStateBadge = ({ state }: { state: IncidentState }) => (
  <Badge tone={incidentTone[state]}>{humanize(state)}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: number | null }) => (
  <Badge mono tone={(priority ?? 5) <= 2 ? "bad" : "neutral"}>
    {priorityLabel(priority)}
  </Badge>
);

const severityTone: Record<Severity, Tone> = { critical: "bad", high: "warn", medium: "info", low: "neutral" };
export const SeverityBadge = ({ severity }: { severity: Severity }) => <Badge tone={severityTone[severity]}>{humanize(severity)}</Badge>;

const findingTone: Record<FindingState, Tone> = {
  requested: "info",
  pending_approval: "warn",
  scheduled: "info",
  remediating: "warn",
  delivered: "good",
  closed: "muted",
  cancelled: "muted",
  risk_accepted: "muted",
};
export const FindingStateBadge = ({ state }: { state: FindingState }) => <Badge tone={findingTone[state]}>{humanize(state)}</Badge>;

/** Requests and changes use the same record states as incidents. */
export const RecordStateBadge = IncidentStateBadge;

const approvalTone: Record<string, Tone> = { not_required: "muted", requested: "warn", approved: "good", rejected: "bad", cancelled: "muted" };
const approvalLabel: Record<string, string> = {
  not_required: "No approval needed",
  requested: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export const ApprovalBadge = ({ status }: { status: string }) => (
  <Badge tone={approvalTone[status] ?? "neutral"}>{approvalLabel[status] ?? humanize(status)}</Badge>
);

const riskTone: Record<string, Tone> = { critical: "bad", high: "warn", medium: "info", low: "neutral" };
export const RiskBadge = ({ risk }: { risk: string }) => <Badge tone={riskTone[risk] ?? "info"}>Risk: {risk}</Badge>;
