import type { FindingState, IncidentState, Severity } from "@/api/types";
import { humanize, priorityLabel } from "@/lib/format";
import { Badge, type Tone } from "./ui";

const incidentTone: Record<IncidentState, Tone> = {
  new: "info",
  open: "info",
  in_progress: "warn",
  pending: "neutral",
  resolved: "good",
  closed: "neutral",
  cancelled: "neutral",
};

export const IncidentStateBadge = ({ state }: { state: IncidentState }) => (
  <Badge tone={incidentTone[state]}>{humanize(state)}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: number | null }) => (
  <Badge tone={priority === 1 ? "bad" : priority === 2 ? "warn" : "neutral"}>{priorityLabel(priority)}</Badge>
);

const severityTone: Record<Severity, Tone> = { critical: "bad", high: "warn", medium: "info", low: "neutral" };
export const SeverityBadge = ({ severity }: { severity: Severity }) => <Badge tone={severityTone[severity]}>{humanize(severity)}</Badge>;

const findingTone: Record<FindingState, Tone> = {
  requested: "info",
  pending_approval: "warn",
  scheduled: "info",
  remediating: "warn",
  delivered: "good",
  closed: "neutral",
  cancelled: "neutral",
  risk_accepted: "neutral",
};
export const FindingStateBadge = ({ state }: { state: FindingState }) => <Badge tone={findingTone[state]}>{humanize(state)}</Badge>;

/** Requests and changes use the same record states as incidents. */
export const RecordStateBadge = IncidentStateBadge;

const approvalTone: Record<string, Tone> = { not_required: "neutral", requested: "warn", approved: "good", rejected: "bad", cancelled: "neutral" };
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
export const RiskBadge = ({ risk }: { risk: string }) => <Badge tone={riskTone[risk] ?? "neutral"}>{humanize(risk)} risk</Badge>;
