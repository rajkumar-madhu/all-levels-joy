import { useState } from "react";
import { Link } from "react-router";
import { useDecideApproval, useMyApprovals } from "@/api/hooks";
import type { MyApproval } from "@/api/types";
import { ApprovalBadge, RiskBadge } from "@/components/badges";
import { Badge, Button, FormError, PageHeader, Panel, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";

export function ApprovalsPage() {
  const workspace = useWorkspace();
  const [status, setStatus] = useState<"requested" | "all">("requested");
  const approvals = useMyApprovals(workspace.id, status);

  return (
    <>
      <PageHeader title="Approvals" description="Requests and changes waiting for your decision." />
      <div role="group" aria-label="Filter approvals" className="flex w-fit rounded-md border border-slate-300 dark:border-slate-700">
        {(
          [
            ["requested", "Waiting for me"],
            ["all", "All"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
            className="px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md aria-pressed:bg-brand-600 aria-pressed:text-white"
          >
            {label}
          </button>
        ))}
      </div>
      {approvals.isPending ? (
        <StateMessage kind="loading">Loading approvals…</StateMessage>
      ) : approvals.isError ? (
        <StateMessage kind="error">{approvals.error.message}</StateMessage>
      ) : approvals.data.length === 0 ? (
        <StateMessage kind="empty">{status === "requested" ? "Nothing is waiting for your decision." : "You have no approvals yet."}</StateMessage>
      ) : (
        <div className="grid gap-3">
          {approvals.data.map((a) => (
            <ApprovalCard key={a.id} approval={a} orgId={workspace.id} />
          ))}
        </div>
      )}
    </>
  );
}

function ApprovalCard({ approval: a, orgId }: { approval: MyApproval; orgId: string }) {
  const decide = useDecideApproval(orgId);
  const [notes, setNotes] = useState("");
  const href = a.record_type === "change" ? `/changes/${a.record_id}` : `/requests/${a.record_id}`;

  return (
    <Panel className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{humanize(a.record_type)}</Badge>
        <Link to={href} className="font-mono text-sm text-brand-600 hover:underline dark:text-brand-100">
          {a.record_number ?? "Record"}
        </Link>
        <span className="min-w-0 flex-1 truncate font-medium">{a.record_title}</span>
        {a.risk && <RiskBadge risk={a.risk} />}
        <ApprovalBadge status={a.status} />
      </div>
      <p className="text-xs text-slate-500">
        Asked {formatDateTime(a.created_at)}
        {a.start_at ? ` · window ${formatDateTime(a.start_at)} – ${formatDateTime(a.end_at)}` : ""}
      </p>
      {a.status === "requested" ? (
        <div className="grid gap-2">
          <Textarea
            id={`approval-notes-${a.id}`}
            aria-label="Decision notes"
            placeholder="Decision notes (required to reject)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
          />
          <FormError error={decide.error} />
          <div className="flex gap-2">
            <Button busy={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: "approved", notes: notes.trim() })}>
              Approve
            </Button>
            <Button
              variant="danger"
              busy={decide.isPending}
              disabled={!notes.trim()}
              onClick={() => decide.mutate({ id: a.id, decision: "rejected", notes: notes.trim() })}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : (
        a.decision_notes && <p className="text-sm text-slate-600 dark:text-slate-400">{a.decision_notes}</p>
      )}
    </Panel>
  );
}
