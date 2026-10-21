import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { useChange, useChangeAction } from "@/api/hooks";
import type { Change, ChangeAction } from "@/api/types";
import { ApprovalTrail } from "@/components/ApprovalTrail";
import { ApprovalBadge, RecordStateBadge, RiskBadge } from "@/components/badges";
import { Badge, Button, Field, FormError, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";
import { CHANGE_UPDATE_ROLES, hasAnyRole } from "@/lib/roles";

export function ChangeDetailPage() {
  const workspace = useWorkspace();
  const { changeId = "" } = useParams();
  const change = useChange(workspace.id, changeId);

  if (change.isPending) return <StateMessage kind="loading">Loading change…</StateMessage>;
  if (change.isError) return <StateMessage kind="error">{change.error.message}</StateMessage>;
  const c = change.data;
  const plans: [string, string | null][] = [
    ["What is changing", c.description],
    ["Why it is needed", c.business_justification],
    ["Impact assessment", c.impact_assessment],
    ["Implementation plan", c.implementation_plan],
    ["Test plan", c.test_plan],
    ["Validation", c.validation_plan],
    ["Rollback plan", c.rollback_plan],
    ["Roll back when", c.rollback_trigger],
    ["Communication", c.communication_plan],
  ];

  return (
    <>
      <Link to="/changes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Changes
      </Link>
      <PageHeader title={`${c.number} · ${c.title}`} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={c.change_type === "emergency" ? "bad" : "neutral"}>{humanize(c.change_type)}</Badge>
        <RiskBadge risk={c.risk} />
        <ApprovalBadge status={c.approval_status} />
        <RecordStateBadge state={c.state} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel className="grid gap-4 p-4">
          {plans.map(([label, text]) => (
            <section key={label}>
              <h2 className="text-sm font-semibold">{label}</h2>
              <p className="text-sm whitespace-pre-wrap text-foreground">{text || "—"}</p>
            </section>
          ))}
          {c.delivery_outcome && (
            <section className="border-t border-border pt-4">
              <h2 className="text-sm font-semibold">Delivery</h2>
              <p className="text-sm">
                {humanize(c.delivery_outcome)}
                {c.rollback_used ? " · rollback used" : ""}
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">{c.validation_results}</p>
              <h3 className="mt-3 text-sm font-semibold">Post-implementation review</h3>
              <p className="text-sm whitespace-pre-wrap text-foreground">{c.pir_notes}</p>
            </section>
          )}
        </Panel>
        <div className="grid gap-6">
          <Panel className="p-4">
            <dl className="grid gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Window</dt><dd>{formatDateTime(c.start_at)} – {formatDateTime(c.end_at)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Expected outage</dt><dd>{c.expected_outage_minutes} min</dd></div>
              <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{c.service_name ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Implementation started</dt><dd>{formatDateTime(c.actual_start_at)}</dd></div>
            </dl>
          </Panel>
          <Panel className="p-4">
            <h2 className="mb-3 text-sm font-semibold">CAB approval</h2>
            <ApprovalTrail approvals={c.approvals} />
          </Panel>
          {hasAnyRole(workspace.roles, CHANGE_UPDATE_ROLES) && <Lifecycle change={c} orgId={workspace.id} />}
        </div>
      </div>
    </>
  );
}

function Lifecycle({ change: c, orgId }: { change: Change; orgId: string }) {
  const act = useChangeAction(orgId);
  const run = (step: ChangeAction) => act.mutate({ id: c.id, step });
  const approved = ["approved", "not_required"].includes(c.approval_status);
  const windowOpen = !c.start_at || Date.parse(c.start_at) <= Date.now();

  return (
    <Panel className="grid gap-3 p-4">
      <h2 className="text-sm font-semibold">Implementation</h2>
      <FormError error={act.error} />
      {c.state === "open" && (
        <>
          {!approved && <p className="text-sm text-warning-foreground">Waiting for CAB approval.</p>}
          {approved && !windowOpen && <p className="text-sm text-muted-foreground">The window opens {formatDateTime(c.start_at)}.</p>}
          <Button busy={act.isPending} disabled={!approved || !windowOpen} onClick={() => run({ action: "start" })}>
            Start implementation
          </Button>
        </>
      )}
      {c.state === "pending" && <p className="text-sm text-warning-foreground">Waiting for CAB approval.</p>}
      {c.state === "in_progress" && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            run({
              action: "deliver",
              deliveryOutcome: String(form.get("outcome")) as "successful",
              validationResults: String(form.get("validation")),
              pirNotes: String(form.get("pir")),
              rollbackUsed: form.get("rollback") === "on",
            });
          }}
        >
          <Field label="Outcome">
            <Select id="change-outcome" name="outcome" defaultValue="successful">
              <option value="successful">Successful</option>
              <option value="successful_with_issues">Successful with issues</option>
              <option value="failed">Failed</option>
              <option value="rolled_back">Rolled back</option>
            </Select>
          </Field>
          <Field label="Validation results">
            <Textarea id="change-validation" name="validation" required rows={2} />
          </Field>
          <Field label="Post-implementation review">
            <Textarea id="change-pir" name="pir" required rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input id="change-rollback" type="checkbox" name="rollback" /> The rollback plan was used
          </label>
          <Button type="submit" busy={act.isPending}>Record delivery</Button>
        </form>
      )}
      {c.state === "resolved" && <Button busy={act.isPending} onClick={() => run({ action: "close" })}>Close change</Button>}
      {!["resolved", "closed", "cancelled"].includes(c.state) && (
        <Button variant="secondary" busy={act.isPending} onClick={() => run({ action: "cancel" })}>Cancel change</Button>
      )}
      {["closed", "cancelled"].includes(c.state) && <p className="text-sm text-muted-foreground">This change is {c.state}.</p>}
    </Panel>
  );
}
