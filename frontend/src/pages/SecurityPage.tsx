import { Plus, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  useCreateFinding,
  useMe,
  useDecideException,
  useRequestException,
  useSecurityBoard,
  useTransitionFinding,
} from "@/api/hooks";
import type { Finding, SecurityBoard, Severity, Transition } from "@/api/types";
import { FindingStateBadge, SeverityBadge } from "@/components/badges";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, formatDateTime, humanize } from "@/lib/format";
import { localWindowTimeToIso, securityWindowPayload, windowTimeToLocalInput } from "@/lib/security-window";

const CLOSED = new Set(["closed", "cancelled", "risk_accepted"]);
// Mirrors the database rules; the functions re-check every action, these only hide buttons that would fail.
const FIX_APPROVERS = new Set(["manager", "admin", "change_manager"]);
const EXCEPTION_APPROVERS = new Set(["manager", "admin"]);

export function SecurityPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const view = params.get("view") ?? "active";
  const selectedId = params.get("finding");
  // Customers never request the board, so they never receive staff-only records or choices.
  const board = useSecurityBoard(workspace.id, workspace.is_staff);

  if (!workspace.is_staff) {
    return <StateMessage kind="error">The Security workspace is available to workspace staff only.</StateMessage>;
  }

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("finding", id);
    else next.delete("finding");
    setParams(next, { replace: true });
  };
  const findings = (board.data?.findings ?? []).filter((f) => (view === "active" ? !CLOSED.has(f.state) : view === "closed" ? CLOSED.has(f.state) : true));
  const selected = board.data?.findings.find((f) => f.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Governance and knowledge"
        title="Security findings"
        description="Vulnerabilities from scanners and staff, each fixed through an approved plan."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" /> Record a finding
          </Button>
        }
      />
      {creating && <NewFindingForm orgId={workspace.id} onDone={() => setCreating(false)} />}

      <div role="group" aria-label="Filter findings" className="flex w-fit rounded-md border border-input">
        {["active", "closed", "all"].map((v) => (
          <button
            key={v}
            aria-pressed={view === v}
            onClick={() => setParams({ view: v }, { replace: true })}
            className="px-3 py-1.5 text-sm capitalize first:rounded-l-md last:rounded-r-md aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {v}
          </button>
        ))}
      </div>

      {board.isPending ? (
        <StateMessage kind="loading">Loading findings…</StateMessage>
      ) : board.isError ? (
        <StateMessage kind="error">{board.error.message}</StateMessage>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          {findings.length === 0 ? (
            <StateMessage kind="empty">No findings in this view.</StateMessage>
          ) : (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={th}>Finding</th>
                    <th className={th}>Severity</th>
                    <th className={th}>State</th>
                    <th className={th}>Fix due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {findings.map((f) => {
                    const due = dueIn(f.due_at);
                    return (
                      <tr
                        key={f.id}
                        onClick={() => select(f.id)}
                        className={`cursor-pointer hover:bg-accent ${f.id === selectedId ? "bg-primary/10" : ""}`}
                      >
                        <td className="px-4 py-2">
                          <button className="text-left" onClick={() => select(f.id)}>
                            <span className="block font-mono text-xs text-muted-foreground">{f.number}</span>
                            <span className="line-clamp-1">{f.title}</span>
                          </button>
                        </td>
                        <td className="px-4 py-2"><SeverityBadge severity={f.severity} /></td>
                        <td className="px-4 py-2"><FindingStateBadge state={f.state} /></td>
                        <td className={`px-4 py-2 tabular-nums whitespace-nowrap ${!CLOSED.has(f.state) && due.overdue ? "text-destructive" : ""}`}>
                          {CLOSED.has(f.state) ? "—" : due.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
          {selected && board.data && (
            <FindingPanel key={selected.id} finding={selected} board={board.data} roles={workspace.roles} orgId={workspace.id} onClose={() => select(null)} />
          )}
        </div>
      )}
    </>
  );
}

function NewFindingForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const create = useCreateFinding(orgId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const reference = String(form.get("reference") ?? "").trim();
    create.mutate(
      {
        title: String(form.get("title")),
        description: String(form.get("description") ?? ""),
        severity: String(form.get("severity")) as Severity,
        ...(reference ? { reference } : {}),
      },
      { onSuccess: onDone },
    );
  };
  return (
    <Panel className="p-4">
      <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem]" onSubmit={submit}>
        <Field label="Title">
          <Input id="finding-title" name="title" required minLength={5} maxLength={160} placeholder="OpenSSL 3.0.13 on api-gateway" />
        </Field>
        <Field label="Severity">
          <Select id="finding-severity" name="severity" defaultValue="high">
            <option value="critical">Critical — fix in 7 days</option>
            <option value="high">High — 30 days</option>
            <option value="medium">Medium — 90 days</option>
            <option value="low">Low — 180 days</option>
          </Select>
        </Field>
        <Field label="Reference">
          <Input id="finding-reference" name="reference" maxLength={120} placeholder="CVE-2024-5535" />
        </Field>
        <div className="md:col-span-3">
          <Field label="Description">
            <Textarea id="finding-description" name="description" maxLength={6000} />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 md:col-span-3">
          <FormError error={create.error} />
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" busy={create.isPending}>Record finding</Button>
        </div>
      </form>
    </Panel>
  );
}

function FindingPanel({ finding: f, board, roles, orgId, onClose }: { finding: Finding; board: SecurityBoard; roles: string[]; orgId: string; onClose: () => void }) {
  const transition = useTransitionFinding(orgId);
  const { data: me } = useMe();
  const run = (step: Transition) => transition.mutate({ id: f.id, step });
  const ownPlan = !!me && f.requester_id === me.user_id;
  const canApproveFix = roles.some((r) => FIX_APPROVERS.has(r)) && !ownPlan;
  const exceptions = board.exceptions.filter((e) => e.finding_id === f.id);
  const open = !CLOSED.has(f.state) && f.state !== "delivered";
  const linkedChange = board.changes.find((c) => c.id === f.change_id);
  const linkedIncident = board.incidents.find((i) => i.id === f.incident_id);

  return (
    <Panel className="grid gap-5 p-4 lg:sticky lg:top-20">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{f.number}{f.reference ? ` · ${f.reference}` : ""}</p>
          <h2 className="font-semibold text-balance">{f.title}</h2>
        </div>
        <button onClick={onClose} aria-label="Close finding"><X className="size-4" /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        <SeverityBadge severity={f.severity} />
        <FindingStateBadge state={f.state} />
        {f.scanner_name && <Badge>{f.scanner_name}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Fact label="Fix due">{formatDateTime(f.due_at)}</Fact>
        <Fact label="Asset">{f.asset_key ?? "—"}</Fact>
        <Fact label="Window">{f.window_start ? `${formatDateTime(f.window_start)} – ${formatDateTime(f.window_end)}` : "Not scheduled"}</Fact>
        <Fact label="Linked">{[linkedChange?.number, linkedIncident?.number].filter(Boolean).join(", ") || "—"}</Fact>
      </dl>
      {f.description && <p className="text-sm whitespace-pre-wrap text-foreground">{f.description}</p>}
      {f.fix_plan && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{f.approver_id ? "Approved plan" : "Submitted plan"}</summary>
          <dl className="mt-2 grid gap-2">
            <Fact label="Impact">{f.impact_assessment}</Fact>
            <Fact label="Fix">{f.fix_plan}</Fact>
            <Fact label="Test">{f.test_plan}</Fact>
            <Fact label="Rollback">{f.rollback_plan}</Fact>
            <Fact label="Roll back when">{f.rollback_trigger}</Fact>
          </dl>
        </details>
      )}

      <FormError error={transition.error} />
      {f.state === "requested" && <SubmitPlanForm busy={transition.isPending} onSubmit={run} />}
      {f.state === "pending_approval" &&
        (canApproveFix ? (
          <DecisionForm busy={transition.isPending} onApprove={(notes) => run({ action: "approve", ...(notes ? { notes } : {}) })} onReject={(notes) => run({ action: "reject", notes })} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {ownPlan
              ? "You raised this finding, so another manager, change manager or admin must approve the plan."
              : "Waiting for a manager, change manager or admin to approve the plan."}
          </p>
        ))}
      {f.state === "scheduled" && <ScheduleForm finding={f} busy={transition.isPending} onSubmit={run} />}
      {f.state === "remediating" && <DeliverForm busy={transition.isPending} onSubmit={run} />}
      {f.state === "delivered" && <Button onClick={() => run({ action: "close" })} busy={transition.isPending}>Close finding</Button>}
      {open && <LinkForm finding={f} board={board} busy={transition.isPending} onSubmit={run} />}

      <ExceptionsSection finding={f} exceptions={exceptions} roles={roles} orgId={orgId} canRequest={open} />

      {open && (
        <Button variant="secondary" onClick={() => run({ action: "cancel" })} busy={transition.isPending}>
          Cancel finding
        </Button>
      )}
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function SubmitPlanForm({ busy, onSubmit }: { busy: boolean; onSubmit: (t: Transition) => void }) {
  const fields = [
    ["impactAssessment", "Impact assessment"],
    ["fixPlan", "Fix plan"],
    ["testPlan", "Test plan"],
    ["rollbackPlan", "Rollback plan"],
    ["rollbackTrigger", "Roll back when"],
  ] as const;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const value = (k: string) => String(form.get(k) ?? "");
        onSubmit({
          action: "submit",
          impactAssessment: value("impactAssessment"),
          fixPlan: value("fixPlan"),
          testPlan: value("testPlan"),
          rollbackPlan: value("rollbackPlan"),
          rollbackTrigger: value("rollbackTrigger"),
        });
      }}
    >
      <h3 className="text-sm font-semibold">Plan the fix</h3>
      {fields.map(([name, label]) => (
        <Field key={name} label={label}>
          <Textarea id={`plan-${name}`} name={name} required minLength={5} maxLength={6000} rows={2} />
        </Field>
      ))}
      <Button type="submit" busy={busy}>Submit for approval</Button>
    </form>
  );
}

function DecisionForm({ busy, onApprove, onReject }: { busy: boolean; onApprove: (notes: string) => void; onReject: (notes: string) => void }) {
  const [notes, setNotes] = useState("");
  return (
    <div className="grid gap-3">
      <Field label="Decision notes" hint="Required when rejecting.">
        <Textarea id="decision-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />
      </Field>
      <div className="flex gap-2">
        <Button busy={busy} onClick={() => onApprove(notes.trim())}>Approve plan</Button>
        <Button variant="danger" busy={busy} disabled={!notes.trim()} onClick={() => onReject(notes.trim())}>Reject</Button>
      </div>
    </div>
  );
}

function ScheduleForm({ finding, busy, onSubmit }: { finding: Finding; busy: boolean; onSubmit: (t: Transition) => void }) {
  const [error, setError] = useState<string | null>(null);
  const windowOpen = finding.window_start && Date.parse(finding.window_start) <= Date.now();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        try {
          // Converted from the user's local time here, in the browser; the API accepts only offset-aware times.
          onSubmit(securityWindowPayload(String(form.get("start")), String(form.get("end"))));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Choose a valid window.");
        }
      }}
    >
      <h3 className="text-sm font-semibold">Fix window</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <Input id="window-start" name="start" type="datetime-local" required defaultValue={windowTimeToLocalInput(finding.window_start)} />
        </Field>
        <Field label="Ends">
          <Input id="window-end" name="end" type="datetime-local" required defaultValue={windowTimeToLocalInput(finding.window_end)} />
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" busy={busy}>Save window</Button>
        <Button type="button" busy={busy} disabled={!windowOpen} onClick={() => onSubmit({ action: "start" })}>
          Start remediation
        </Button>
      </div>
    </form>
  );
}

function DeliverForm({ busy, onSubmit }: { busy: boolean; onSubmit: (t: Transition) => void }) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        onSubmit({
          action: "deliver",
          outcome: String(form.get("outcome")) as "successful" | "partial" | "failed",
          validationResults: String(form.get("validationResults")),
          reviewNotes: String(form.get("reviewNotes")),
          rollbackUsed: form.get("rollbackUsed") === "on",
        });
      }}
    >
      <h3 className="text-sm font-semibold">Record delivery</h3>
      <Field label="Outcome">
        <Select id="deliver-outcome" name="outcome" defaultValue="successful">
          <option value="successful">Successful</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
        </Select>
      </Field>
      <Field label="Validation results">
        <Textarea id="deliver-validation" name="validationResults" required minLength={5} rows={2} />
      </Field>
      <Field label="Review notes">
        <Textarea id="deliver-review" name="reviewNotes" required minLength={5} rows={2} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input id="deliver-rollback" type="checkbox" name="rollbackUsed" /> The rollback plan was used
      </label>
      <Button type="submit" busy={busy}>Record delivery</Button>
    </form>
  );
}

function LinkForm({ finding, board, busy, onSubmit }: { finding: Finding; board: SecurityBoard; busy: boolean; onSubmit: (t: Transition) => void }) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        onSubmit({ action: "link", changeId: String(form.get("changeId")), incidentId: String(form.get("incidentId")) });
      }}
    >
      <h3 className="text-sm font-semibold">Linked records</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Change">
          <Select id="link-change" name="changeId" defaultValue={finding.change_id ?? ""}>
            <option value="">None</option>
            {board.changes.map((c) => <option key={c.id} value={c.id}>{c.number} · {c.title}</option>)}
          </Select>
        </Field>
        <Field label="Incident">
          <Select id="link-incident" name="incidentId" defaultValue={finding.incident_id ?? ""}>
            <option value="">None</option>
            {board.incidents.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.title}</option>)}
          </Select>
        </Field>
      </div>
      <Button type="submit" variant="secondary" busy={busy}>Save links</Button>
    </form>
  );
}

function ExceptionsSection({ finding, exceptions, roles, orgId, canRequest }: {
  finding: Finding;
  exceptions: SecurityBoard["exceptions"];
  roles: string[];
  orgId: string;
  canRequest: boolean;
}) {
  const request = useRequestException(orgId);
  const decide = useDecideException(orgId);
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const canDecide = roles.some((r) => EXCEPTION_APPROVERS.has(r));
  const pending = exceptions.some((e) => e.status === "requested");

  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Risk exceptions</h3>
      {exceptions.length === 0 && <p className="text-sm text-muted-foreground">None requested.</p>}
      {exceptions.map((e) => (
        <div key={e.id} className="grid gap-1 rounded-md border border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge tone={e.status === "approved" ? "good" : e.status === "rejected" ? "bad" : e.status === "expired" ? "neutral" : "warn"}>
              {humanize(e.status)}
            </Badge>
            <span className="text-xs text-muted-foreground">expires {formatDateTime(e.expires_at)}</span>
          </div>
          <p>{e.justification}</p>
          <p className="text-muted-foreground">Controls: {e.compensating_controls}</p>
          {e.decision_notes && <p className="text-muted-foreground">Decision: {e.decision_notes}</p>}
          {e.status === "requested" && canDecide && (
            <div className="mt-2 grid gap-2">
              <Textarea id={`exception-notes-${e.id}`} aria-label="Decision notes" placeholder="Decision notes (required to reject)" value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} />
              <div className="flex gap-2">
                <Button busy={decide.isPending} onClick={() => decide.mutate({ id: e.id, decision: "approved", notes })}>Accept risk</Button>
                <Button variant="danger" busy={decide.isPending} disabled={!notes.trim()} onClick={() => decide.mutate({ id: e.id, decision: "rejected", notes })}>
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      <FormError error={decide.error ?? request.error} />
      {canRequest && !pending && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Request a risk exception</summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                request.mutate({
                  findingId: finding.id,
                  justification: String(form.get("justification")),
                  compensatingControls: String(form.get("controls")),
                  expiresAt: localWindowTimeToIso(String(form.get("expires"))),
                });
                setLocalError(null);
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : "Choose a valid expiry.");
              }
            }}
          >
            <Field label="Why can't this be fixed now?">
              <Textarea id="exception-justification" name="justification" required minLength={10} maxLength={4000} rows={2} />
            </Field>
            <Field label="Compensating controls">
              <Textarea id="exception-controls" name="controls" required minLength={10} maxLength={4000} rows={2} />
            </Field>
            <Field label="Exception expires" hint="Within the next year.">
              <Input id="exception-expires" name="expires" type="datetime-local" required />
            </Field>
            {localError && <p role="alert" className="text-destructive">{localError}</p>}
            <Button type="submit" variant="secondary" busy={request.isPending}>Request exception</Button>
          </form>
        </details>
      )}
    </div>
  );
}
