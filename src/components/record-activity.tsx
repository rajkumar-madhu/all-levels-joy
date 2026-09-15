import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { addComment } from "@/lib/itsm.functions";
import { activityQuery } from "@/lib/workspace-queries";
import { formatDateTime } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RecordActivity({
  recordType,
  recordId,
  canPostInternal,
}: {
  recordType: string;
  recordId: string;
  canPostInternal: boolean;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const activity = useQuery(activityQuery(recordType, recordId));

  const post = useMutation({
    mutationFn: () => addComment({ data: { recordType, recordId, body, internal } }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["activity", recordType, recordId] });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Note added to the record.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Note not saved."),
  });

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Activity & notes</h3>

      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a work note or customer update"
          rows={3}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={() => post.mutate()}
            disabled={body.trim().length === 0 || post.isPending}
          >
            Add note
          </Button>
          {canPostInternal ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />
              Internal work note
            </label>
          ) : null}
        </div>
      </div>

      <ol className="space-y-2">
        {(activity.data?.comments ?? []).map((comment) => (
          <li key={comment.id} className="rounded-md border border-border bg-card p-3 text-sm">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{comment.internal ? "Internal note" : "Update"}</span>
              <span>{formatDateTime(comment.created_at)}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-foreground">{comment.body}</p>
          </li>
        ))}
        {(activity.data?.comments ?? []).length === 0 ? (
          <li className="text-sm text-muted-foreground">No notes on this record yet.</li>
        ) : null}
      </ol>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Audit history
        </h4>
        <ol className="mt-2 space-y-1.5 text-xs">
          {(activity.data?.audit ?? []).map((event) => (
            <li key={event.id} className="flex justify-between gap-3 border-b border-border pb-1.5">
              <span className="font-mono text-foreground">{event.action}</span>
              <span className="text-muted-foreground">{formatDateTime(event.created_at)}</span>
            </li>
          ))}
          {(activity.data?.audit ?? []).length === 0 ? (
            <li className="text-muted-foreground">No audit entries recorded yet.</li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}
