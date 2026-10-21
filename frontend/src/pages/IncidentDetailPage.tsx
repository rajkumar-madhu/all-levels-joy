import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useGroups, useIncident, useUpdateIncident } from "@/api/hooks";
import type { Incident, IncidentState, IncidentUpdate } from "@/api/types";
import { Attachments } from "@/components/Attachments";
import { Comments } from "@/components/Comments";
import { RecordActivity } from "@/components/RecordActivity";
import { IncidentStateBadge, PriorityBadge } from "@/components/badges";
import { Button, Field, FormError, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, formatDateTime, humanize } from "@/lib/format";
import { CLOSE_CODES, HOLD_REASONS, INCIDENT_TRANSITIONS, INCIDENT_UPDATE_ROLES } from "@/lib/incident-workflow";
import { hasAnyRole } from "@/lib/roles";

export function IncidentDetailPage() {
  const workspace = useWorkspace();
  const { incidentId = "" } = useParams();
  const incident = useIncident(workspace.id, incidentId);
  const operator = hasAnyRole(workspace.roles, INCIDENT_UPDATE_ROLES);

  if (incident.isPending) return <StateMessage kind="loading">Loading incident…</StateMessage>;
  if (incident.isError) return <StateMessage kind="error">{incident.error.message}</StateMessage>;
  const i = incident.data;
  const due = dueIn(i.sla_due_at);
  const facts: [string, ReactNode][] = [
    ["State", <IncidentStateBadge state={i.state} />],
    ["Priority", <PriorityBadge priority={i.priority} />],
    ["Impact / urgency", `${i.impact} / ${i.urgency}`],
    // Requesters can't read staff profiles, so they see that someone has it rather than who.
    ["Assigned to", i.assignee_name ?? (i.assignee_id ? "A support agent" : "Unassigned")],
    ["Group", i.group_name ?? "—"],
    ["On hold", i.on_hold_reason ? (HOLD_REASONS[i.on_hold_reason] ?? humanize(i.on_hold_reason)) : "—"],
    ["Category", humanize(i.category)],
    ["Raised via", humanize(i.contact_type)],
    ["SLA target", i.sla_due_at ? `${formatDateTime(i.sla_due_at)} (${due.label})` : "—"],
    ["First response", formatDateTime(i.first_responded_at)],
    ["Opened", formatDateTime(i.created_at)],
    ["Resolved", formatDateTime(i.resolved_at)],
  ];

  return (
    <>
      <Link to="/incidents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Incidents
      </Link>
      <PageHeader title={`${i.number} · ${i.title}`} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <Panel className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Description</h2>
            <p className="text-sm whitespace-pre-wrap">{i.description || "No description."}</p>
            {i.resolution_notes && (
              <>
                <h2 className="mt-6 mb-2 text-sm font-semibold">Resolution</h2>
                <p className="text-sm whitespace-pre-wrap">{i.resolution_notes}</p>
                {i.close_code && <p className="mt-1 text-xs text-muted-foreground">{CLOSE_CODES[i.close_code] ?? i.close_code}</p>}
              </>
            )}
          </Panel>
          <Comments orgId={workspace.id} recordType="incident" recordId={i.id} canWriteInternal={workspace.is_staff} />
          <Attachments orgId={workspace.id} recordType="incident" recordId={i.id} />
          <RecordActivity orgId={workspace.id} recordType="incident" recordId={i.id} />
        </div>
        <div className="grid gap-6">
          <Panel className="p-4">
            <dl className="grid gap-3 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          {/* Keyed on updated_at so the form resets to the saved values after every save. */}
          {operator && <WorkPanel key={i.updated_at} incident={i} orgId={workspace.id} />}
        </div>
      </div>
    </>
  );
}

function WorkPanel({ incident: i, orgId }: { incident: Incident; orgId: string }) {
  const update = useUpdateIncident(orgId, i.id);
  const groups = useGroups(orgId, true);
  const [state, setState] = useState<IncidentState>(i.state);
  const options = [i.state, ...INCIDENT_TRANSITIONS[i.state]];
  const resolving = state === "resolved" || state === "closed";

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: IncidentUpdate = { expectedUpdatedAt: i.updated_at };
    if (state !== i.state) body.state = state;
    const group = String(form.get("group") ?? "");
    if (group !== (i.group_id ?? "")) body.groupId = group || null;
    const impact = Number(form.get("impact"));
    const urgency = Number(form.get("urgency"));
    if (impact !== i.impact) body.impact = impact;
    if (urgency !== i.urgency) body.urgency = urgency;
    if (state === "pending") body.onHoldReason = String(form.get("holdReason") ?? "") || null;
    if (resolving) {
      body.resolutionNotes = String(form.get("resolutionNotes") ?? "");
      body.closeCode = String(form.get("closeCode") ?? "") || null;
    }
    update.mutate(body);
  };

  return (
    <Panel className="p-4">
      <form className="grid gap-3" onSubmit={submit}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Work this incident</h2>
          <Button
            type="button"
            variant="secondary"
            busy={update.isPending}
            onClick={() => update.mutate({ expectedUpdatedAt: i.updated_at, assignToMe: true })}
          >
            Assign to me
          </Button>
        </div>
        <Field label="State">
          <Select id="incident-state" value={state} onChange={(e) => setState(e.target.value as IncidentState)} disabled={options.length === 1}>
            {options.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
        </Field>
        {state === "pending" && (
          <Field label="Hold reason">
            <Select id="incident-hold" name="holdReason" defaultValue={i.on_hold_reason ?? ""} required>
              <option value="" disabled>Choose a reason</option>
              {Object.entries(HOLD_REASONS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
        )}
        {resolving && (
          <>
            <Field label="Resolution notes">
              <Textarea id="incident-resolution" name="resolutionNotes" defaultValue={i.resolution_notes ?? ""} required maxLength={4000} rows={3} />
            </Field>
            <Field label="Close code">
              <Select id="incident-close-code" name="closeCode" defaultValue={i.close_code ?? ""} required>
                <option value="" disabled>Choose a close code</option>
                {Object.entries(CLOSE_CODES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Assignment group">
          <Select id="incident-group" name="group" defaultValue={i.group_id ?? ""}>
            <option value="">No group</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Impact">
            <Select id="incident-edit-impact" name="impact" defaultValue={String(i.impact)}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Urgency">
            <Select id="incident-edit-urgency" name="urgency" defaultValue={String(i.urgency)}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </div>
        <FormError error={update.error} />
        <Button type="submit" busy={update.isPending}>Save</Button>
      </form>
    </Panel>
  );
}
