import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { decideApproval } from "@/lib/itsm.functions";
import { formatDateTime } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — WeCrew ITSM" },
      {
        name: "description",
        content: "Decide the request and change approvals assigned to you, with decision notes kept on record.",
      },
      { property: "og:title", content: "Approvals — WeCrew ITSM" },
      { property: "og:description", content: "Request and CAB approvals assigned to you." },
    ],
  }),
  component: Approvals,
});

function Approvals() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const data = workspace.data;
  const mine = (data?.approvals ?? []).filter(
    (item) => item.approver_id === data?.userId && item.status === "requested",
  );
  const records = [...(data?.requests ?? []), ...(data?.changes ?? [])];

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approved" | "rejected"; notes?: string }) => {
      if (input.decision === "rejected" && !input.notes?.trim()) {
        throw new Error("Decision notes are required when rejecting a change.");
      }
      return decideApproval({ data: input });
    },
    onSuccess: async () => {
      toast.success("Decision recorded.");
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The decision was not recorded."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Governance"
        title="Approvals"
        description="Approving a request or change moves it forward; rejecting cancels it. Both outcomes are audited."
      />

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : mine.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing waiting on you"
            hint="Approvals assigned to you appear here as soon as they are raised."
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {mine.map((approval) => {
            const record = records.find((item) => item.id === approval.record_id);
            const change = approval.record_type === "change"
              ? (data?.changes ?? []).find((item) => item.id === approval.record_id)
              : null;
            return (
              <li key={approval.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded border border-border bg-secondary px-2 py-0.5 capitalize text-secondary-foreground">
                    {approval.record_type}
                  </span>
                  <span className="font-mono">{record?.number ?? "Record"}</span>
                  <span>Raised {formatDateTime(approval.created_at)}</span>
                </div>
                <h2 className="mt-2 text-base font-semibold text-foreground">
                  {record?.title ?? "Awaiting record details"}
                </h2>
                {change ? (
                  <div className="mt-3 grid gap-3 rounded-md border border-border bg-background p-3 text-xs sm:grid-cols-2">
                    <Detail label="Risk" value={change.risk} />
                    <Detail label="Window" value={`${formatDateTime(change.start_at)} → ${formatDateTime(change.end_at)}`} />
                    <Detail label="Impact assessment" value={change.impact_assessment} />
                    <Detail label="Expected outage" value={`${change.expected_outage_minutes} minutes`} />
                    <Detail label="Implementation plan" value={change.implementation_plan} />
                    <Detail label="Validation plan" value={change.validation_plan} />
                    <Detail label="Rollback plan" value={change.rollback_plan} />
                    <Detail label="Rollback trigger" value={change.rollback_trigger} />
                    <Link to="/changes" search={{ record: change.id }} className="text-primary underline underline-offset-4 sm:col-span-2">Open full change record</Link>
                  </div>
                ) : null}
                {record?.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {record.description}
                  </p>
                ) : null}
                <div className="mt-4 space-y-2">
                  <Textarea
                    rows={2}
                    placeholder="Decision notes (optional)"
                    value={notes[approval.id] ?? ""}
                    onChange={(event) =>
                      setNotes({ ...notes, [approval.id]: event.target.value })
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        decide.mutate({
                          id: approval.id,
                          decision: "approved",
                          notes: notes[approval.id] ?? "",
                        })
                      }
                      disabled={decide.isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        decide.mutate({
                          id: approval.id,
                          decision: "rejected",
                          notes: notes[approval.id] ?? "",
                        })
                      }
                      disabled={decide.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="mt-0.5 whitespace-pre-wrap text-foreground">{value || "—"}</p></div>;
}
