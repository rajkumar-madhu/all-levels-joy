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
