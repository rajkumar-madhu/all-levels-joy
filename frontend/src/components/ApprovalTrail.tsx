import type { ApprovalLine } from "@/api/types";
import { formatDateTime } from "@/lib/format";
import { ApprovalBadge } from "./badges";

export function ApprovalTrail({ approvals }: { approvals: ApprovalLine[] }) {
  if (!approvals.length) return <p className="text-sm text-slate-600 dark:text-slate-400">No approval is needed.</p>;
  return (
    <ul className="grid gap-2 text-sm">
      {approvals.map((a) => (
        <li key={a.id} className="grid gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{a.approver_name ?? "Approver"}</span>
            <ApprovalBadge status={a.status} />
          </div>
          {a.decided_at && <span className="text-xs text-slate-500">{formatDateTime(a.decided_at)}</span>}
          {a.decision_notes && <p className="text-slate-600 dark:text-slate-400">{a.decision_notes}</p>}
        </li>
      ))}
    </ul>
  );
}
