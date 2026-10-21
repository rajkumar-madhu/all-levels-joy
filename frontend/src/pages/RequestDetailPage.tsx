import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useServiceRequest, useUpdateRequest } from "@/api/hooks";
import type { RecordState, ServiceRequest } from "@/api/types";
import { ApprovalTrail } from "@/components/ApprovalTrail";
import { Attachments } from "@/components/Attachments";
import { Comments } from "@/components/Comments";
import { RecordActivity } from "@/components/RecordActivity";
import { RequestTasks } from "@/components/RequestTasks";
import { ApprovalBadge, PriorityBadge, RecordStateBadge } from "@/components/badges";
import { Button, Field, FormError, PageHeader, Panel, Select, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, formatDateTime, humanize } from "@/lib/format";
import { REQUEST_UPDATE_ROLES, hasAnyRole } from "@/lib/roles";

const STATES: RecordState[] = ["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"];

export function RequestDetailPage() {
  const workspace = useWorkspace();
  const { requestId = "" } = useParams();
  const request = useServiceRequest(workspace.id, requestId);

  if (request.isPending) return <StateMessage kind="loading">Loading request…</StateMessage>;
  if (request.isError) return <StateMessage kind="error">{request.error.message}</StateMessage>;
  const r = request.data;
  const due = dueIn(r.due_at);

  return (
    <>
      <Link to="/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Service requests
      </Link>
      <PageHeader title={`${r.number} · ${r.title}`} description={r.catalog_item_name ?? undefined} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <Panel className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <p className="text-sm whitespace-pre-wrap">{r.description || "No details."}</p>
          </Panel>
          <Panel className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Approval</h2>
            <ApprovalTrail approvals={r.approvals} />
          </Panel>
          {workspace.is_staff && (
            <RequestTasks orgId={workspace.id} requestId={r.id} approved={["approved", "not_required"].includes(r.approval_status)} />
          )}
          <Comments orgId={workspace.id} recordType="request" recordId={r.id} canWriteInternal={workspace.is_staff} />
          <Attachments orgId={workspace.id} recordType="request" recordId={r.id} />
          <RecordActivity orgId={workspace.id} recordType="request" recordId={r.id} />
        </div>
        <div className="grid gap-6">
          <Panel className="p-4">
            <dl className="grid gap-3 text-sm">
              <Fact label="State"><RecordStateBadge state={r.state} /></Fact>
              <Fact label="Approval"><ApprovalBadge status={r.approval_status} /></Fact>
              <Fact label="Priority"><PriorityBadge priority={r.priority} /></Fact>
              <Fact label="Assigned group">{r.group_name ?? "—"}</Fact>
              <Fact label="Target date">{r.due_at ? `${formatDateTime(r.due_at)} (${due.label})` : "—"}</Fact>
              <Fact label="Waiting on requester since">{formatDateTime(r.awaiting_customer_since)}</Fact>
              <Fact label="Opened">{formatDateTime(r.created_at)}</Fact>
            </dl>
          </Panel>
          {hasAnyRole(workspace.roles, REQUEST_UPDATE_ROLES) && <FulfilmentForm key={r.updated_at} request={r} orgId={workspace.id} />}
        </div>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FulfilmentForm({ request: r, orgId }: { request: ServiceRequest; orgId: string }) {
  const update = useUpdateRequest(orgId);
  const [state, setState] = useState<RecordState>(r.state);
  const [awaiting, setAwaiting] = useState(Boolean(r.awaiting_customer_since));
  const blocked = r.approval_status === "requested" || r.approval_status === "rejected";

  return (
    <Panel className="p-4">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ id: r.id, state, expectedUpdatedAt: r.updated_at, awaitingCustomer: awaiting });
        }}
      >
        <h2 className="text-sm font-semibold">Fulfilment</h2>
        {blocked && (
          <p className="text-sm text-warning-foreground">
            {r.approval_status === "rejected" ? "This request was rejected." : "Work can start once the request is approved."}
          </p>
        )}
        <Field label="State">
          <Select id="request-state" value={state} onChange={(e) => setState(e.target.value as RecordState)}>
            {STATES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input id="request-awaiting" type="checkbox" checked={awaiting} onChange={(e) => setAwaiting(e.target.checked)} />
          Waiting on the requester (pauses the target)
        </label>
        <FormError error={update.error} />
        <Button type="submit" busy={update.isPending}>Save</Button>
      </form>
    </Panel>
  );
}
