import { Lock } from "lucide-react";
import { useState } from "react";
import { useAddComment, useComments } from "@/api/hooks";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, FormError, Panel, StateMessage, Textarea } from "./ui";

/** Conversation on a record. Staff can add internal notes, which the API never returns to requesters. */
export function Comments({ orgId, recordType, recordId, canWriteInternal }: {
  orgId: string;
  recordType: "incident" | "request";
  recordId: string;
  canWriteInternal: boolean;
}) {
  const comments = useComments(orgId, recordType, recordId);
  const add = useAddComment(orgId, recordType, recordId);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);

  return (
    <Panel className="grid gap-4 p-4">
      <h2 className="text-sm font-semibold">Conversation</h2>
      {comments.isPending ? (
        <StateMessage kind="loading">Loading comments…</StateMessage>
      ) : comments.isError ? (
        <StateMessage kind="error">{comments.error.message}</StateMessage>
      ) : comments.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ol className="grid gap-3">
          {comments.data.map((c) => (
            <li
              key={c.id}
              className={`grid gap-1 rounded-md p-3 text-sm ${c.internal ? "bg-warning/10 border border-warning/30" : "bg-muted"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.author_name ?? "Someone"}</span>
                <span>{formatDateTime(c.created_at)}</span>
                {c.internal && (
                  <Badge tone="warn">
                    <Lock className="mr-1 inline size-3" aria-hidden />
                    Internal
                  </Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          add.mutate({ body: body.trim(), internal }, { onSuccess: () => setBody("") });
        }}
      >
        <Textarea
          id={`comment-${recordType}`}
          aria-label="Add a comment"
          placeholder={internal ? "Internal note for staff" : "Add a comment"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={3}
        />
        <FormError error={add.error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canWriteInternal ? (
            <label className="flex items-center gap-2 text-sm">
              <input id={`comment-internal-${recordType}`} type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal note (hidden from the requester)
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" busy={add.isPending} disabled={!body.trim()}>
            {internal ? "Add internal note" : "Comment"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
