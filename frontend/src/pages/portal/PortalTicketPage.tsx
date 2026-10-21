import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { usePortal, usePortalReply } from "@/api/portal";
import { IncidentStateBadge } from "@/components/badges";
import { Button, FormError, Panel, StateMessage, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/stores/session";

const OUTCOMES = {
  comment: "Your reply was sent.",
  resumed: "Your reply was sent and the ticket is back with the team.",
  reopened: "Your reply reopened the ticket.",
  closed: "Your reply was added. This ticket is closed, so raise a new one if the problem is back.",
};

export function PortalTicketPage() {
  const { recordType = "incidents", recordId = "" } = useParams();
  const kind = recordType === "requests" ? "request" : "incident";
  const status = useSession((s) => s.status);
  const portal = usePortal();
  const reply = usePortalReply();
  const [body, setBody] = useState("");

  if (status !== "signed-in") return <StateMessage kind="loading">Signing you in…</StateMessage>;
  if (portal.isPending) return <StateMessage kind="loading">Loading…</StateMessage>;
  if (portal.isError) return <StateMessage kind="error">{portal.error.message}</StateMessage>;
  if (!portal.data.allowed) return <StateMessage kind="error">The support portal is available to confirmed company email accounts only.</StateMessage>;

  const data = portal.data;
  const record = kind === "incident" ? data.incidents.find((i) => i.id === recordId) : data.requests.find((r) => r.id === recordId);
  if (!record) return <StateMessage kind="error">This ticket was not found among the ones you raised.</StateMessage>;
  const comments = data.comments.filter((c) => c.record_id === recordId);
  const incident = kind === "incident" ? data.incidents.find((i) => i.id === recordId) : undefined;
  const problem = incident?.problem_id ? data.problems.find((p) => p.id === incident.problem_id) : undefined;
  const outage = data.outageUpdates.filter((u) => u.incident_id === recordId);

  return (
    <>
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Your tickets
      </Link>
      <div className="grid gap-2">
        <p className="font-mono text-xs text-muted-foreground">{record.number}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{record.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <IncidentStateBadge state={record.state} />
          <span>Raised {formatDateTime(record.created_at)}</span>
        </div>
      </div>
      <Panel className="grid gap-3 p-5 text-sm">
        <p className="whitespace-pre-wrap">{record.description || "No description."}</p>
        {incident?.resolution_notes && (
          <div>
            <h2 className="font-semibold">Resolution</h2>
            <p className="whitespace-pre-wrap">{incident.resolution_notes}</p>
          </div>
        )}
        {problem?.workaround && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <h2 className="font-semibold">Known issue {problem.number}: workaround</h2>
            <p className="whitespace-pre-wrap">{problem.workaround}</p>
          </div>
        )}
      </Panel>
      {outage.length > 0 && (
        <Panel className="grid gap-2 p-5 text-sm">
          <h2 className="font-semibold">Service updates</h2>
          <ol className="grid gap-2">
            {outage.map((u) => (
              <li key={u.id}>
                <span className="text-xs text-muted-foreground">{formatDateTime(u.created_at)}</span>
                <p className="whitespace-pre-wrap">{u.body}</p>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <Panel className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">Conversation</h2>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <ol className="grid gap-3">
            {comments.map((c) => (
              <li key={c.id} className={`grid gap-1 rounded-md p-3 text-sm ${c.mine ? "bg-accent" : "bg-muted"}`}>
                <span className="text-xs text-muted-foreground">
                  {c.mine ? "You" : "Support team"} · {formatDateTime(c.created_at)}
                </span>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ol>
        )}
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reply.mutate({ recordType: kind, recordId, body: body.trim() }, { onSuccess: () => setBody("") });
          }}
        >
          <Textarea id="portal-reply" aria-label="Reply" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
          <FormError error={reply.error} />
          {reply.data && <p role="status" className="text-sm text-success">{OUTCOMES[reply.data.outcome]}</p>}
          <div>
            <Button type="submit" busy={reply.isPending} disabled={!body.trim()}>Send reply</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
