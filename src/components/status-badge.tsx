import { cn } from "@/lib/utils";
import {
  SLA_LABELS,
  STATE_LABELS,
  priorityLabel,
  slaState,
  type RecordState,
} from "@/lib/itsm-shared";

const base =
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StateBadge({ state }: { state: RecordState }) {
  const tone: Record<RecordState, string> = {
    new: "border-border bg-secondary text-secondary-foreground",
    open: "border-primary/30 bg-primary/10 text-primary",
    in_progress: "border-primary/40 bg-primary/15 text-primary",
    pending: "border-warning/40 bg-warning/10 text-warning",
    resolved: "border-success/40 bg-success/15 text-success",
    closed: "border-border bg-muted text-muted-foreground",
    cancelled: "border-border bg-muted text-muted-foreground line-through",
  };
  return <span className={cn(base, tone[state])}>{STATE_LABELS[state]}</span>;
}

export function PriorityBadge({ priority }: { priority: number | null }) {
  const critical = (priority ?? 5) <= 2;
  return (
    <span
      className={cn(
        base,
        "font-mono",
        critical
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-secondary text-secondary-foreground",
      )}
    >
      {priorityLabel(priority)}
    </span>
  );
}

export function SlaBadge({
  dueAt,
  resolvedAt,
  recordState,
  now,
}: {
  dueAt: string | null;
  resolvedAt: string | null;
  recordState?: RecordState;
  now?: number;
}) {
  const state = slaState(dueAt, resolvedAt, now);
  const tone: Record<string, string> = {
    none: "border-border bg-muted text-muted-foreground",
    breached: "border-destructive/40 bg-destructive/10 text-destructive",
    at_risk: "border-warning/50 bg-warning/10 text-warning",
    on_track: "border-success/40 bg-success/10 text-success",
    completed: "border-border bg-secondary text-secondary-foreground",
    completed_late: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  if (recordState === "cancelled")
    return <span className={cn(base, tone["none"])}>SLA: Cancelled</span>;
  return <span className={cn(base, tone[state])}>SLA: {SLA_LABELS[state]}</span>;
}

export function RiskBadge({ risk }: { risk: string }) {
  const tone: Record<string, string> = {
    low: "border-border bg-secondary text-secondary-foreground",
    medium: "border-primary/30 bg-primary/10 text-primary",
    high: "border-warning/50 bg-warning/10 text-warning",
    critical: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  return <span className={cn(base, tone[risk] ?? tone["medium"])}>Risk: {risk}</span>;
}
