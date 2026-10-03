import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { RecordActivity } from "@/components/record-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, type AppRole } from "@/lib/itsm-shared";
import {
  createSecurityFinding,
  decideSecurityException,
  getSecurityBoard,
  requestSecurityException,
  transitionSecurityFinding,
} from "@/lib/security.functions";
import { SEVERITIES, SEVERITY_DAYS, type TransitionInput } from "@/lib/security-workflow";

const FILTERS = ["all", "open", "overdue", "critical_high", "scanner", "exceptions_expiring"] as const;

export const Route = createFileRoute("/_authenticated/security")({
  validateSearch: z.object({
    record: z.string().optional(),
    filter: z.enum(FILTERS).optional(),
  }),
  head: () => ({
    meta: [
      { title: "Security findings — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Track vulnerabilities and audit findings from request to approved, scheduled and delivered fixes, with risk exceptions.",
      },
      { property: "og:title", content: "Security findings — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Vulnerability remediation and risk exceptions with approvals and rollback plans.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecurityPage,
});

const STATE_TEXT: Record<string, string> = {
  requested: "Requested",
  pending_approval: "Pending approval",
  scheduled: "Approved / scheduled",
  remediating: "Remediating",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
  risk_accepted: "Risk accepted",
};
const SEV_CLASS: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/15 text-destructive",
  medium: "bg-secondary text-secondary-foreground",
  low: "bg-muted text-muted-foreground",
};
const OPEN = ["requested", "pending_approval", "scheduled", "remediating"];

function SecurityPage() {
  const workspace = useWorkspace();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/security" });
  const queryClient = useQueryClient();
  const board = useQuery({ queryKey: ["security-board"], queryFn: () => getSecurityBoard() });
  const roles = (workspace.data?.roles ?? []) as AppRole[];
  const userId = workspace.data?.userId;
  const canApprove = roles.some((r) => ["manager", "admin", "change_manager"].includes(r));
  const canDecideException = roles.some((r) => ["manager", "admin"].includes(r));
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const filter = search.filter ?? "all";

  const findings = board.data?.findings ?? [];
  const exceptions = board.data?.exceptions ?? [];
  const now = Date.now();
  const expiringSoon = (fid: string) =>
    exceptions.some(
      (e) =>
        e.finding_id === fid &&
        e.status === "approved" &&
        Date.parse(e.expires_at) - now < 30 * 86_400_000,
    );
  const visible = useMemo(
    () =>
      findings.filter((f) => {
        const text = `${f.number} ${f.title} ${f.reference ?? ""}`.toLowerCase();
        if (q && !text.includes(q.toLowerCase())) return false;
        switch (filter) {
          case "open":
            return OPEN.includes(f.state);
          case "overdue":
            return OPEN.includes(f.state) && Date.parse(f.due_at) < now;
          case "critical_high":
            return OPEN.includes(f.state) && ["critical", "high"].includes(f.severity);
          case "scanner":
            return f.source === "scanner";
          case "exceptions_expiring":
            return f.state === "risk_accepted" && expiringSoon(f.id);
          default:
            return true;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findings, exceptions, q, filter],
  );
  const selected = findings.find((f) => f.id === search.record) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["security-board"] });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof createSecurityFinding>[0]["data"]) =>
      createSecurityFinding({ data: input }),
    onSuccess: async (r) => {
      toast.success(`${r.number} recorded.`);
      setShowNew(false);
      await refresh();
      void navigate({ search: { record: r.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Finding was not saved."),
  });

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        eyebrow="Security"
        title="Security findings"
        description="Vulnerabilities and audit findings move through request, approval, schedule and delivery. Risk exceptions are approved by a manager and expire automatically."
        actions={<Button onClick={() => setShowNew((v) => !v)}>New finding</Button>}
      />
      {showNew ? <NewFinding onSubmit={(d) => create.mutate(d)} pending={create.isPending} /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search number, title or reference"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search findings"
        />
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => void navigate({ search: (s) => ({ ...s, filter: f }) })}
          >
            {
              {
                all: "All",
                open: "Open",
                overdue: "Overdue",
                critical_high: "Critical & high",
                scanner: "From scanners",
                exceptions_expiring: "Exceptions expiring",
              }[f]
            }
          </Button>
        ))}
      </div>

      {board.isPending || workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : board.isError ? (
        <p className="mt-6 text-sm text-destructive">Security findings could not be loaded.</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {visible.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No findings match" hint="Change the filter or record a new finding." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((f) => {
                  const overdue = OPEN.includes(f.state) && Date.parse(f.due_at) < now;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => void navigate({ search: (s) => ({ ...s, record: f.id }) })}
                        className={`w-full p-3 text-left hover:bg-muted ${f.id === selected?.id ? "bg-muted" : ""}`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">{f.number}</span>
                          <span className={`rounded px-1.5 py-0.5 capitalize ${SEV_CLASS[f.severity]}`}>
                            {f.severity}
                          </span>
                          <span className="text-muted-foreground">{STATE_TEXT[f.state]}</span>
                          {overdue ? <span className="text-destructive">Overdue</span> : null}
                          {f.source === "scanner" ? (
                            <span className="text-muted-foreground">· {f.scanner_name}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm font-medium text-foreground">{f.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.reference ? `${f.reference} · ` : ""}Due {formatDateTime(f.due_at)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {selected ? (
            <FindingDetail
              key={selected.id}
              finding={selected}
              exceptions={exceptions.filter((e) => e.finding_id === selected.id)}
              changes={board.data!.changes}
              incidents={board.data!.incidents}
              canApprove={canApprove && selected.requester_id !== userId}
              canDecideException={canDecideException}
              userId={userId}
              onChanged={refresh}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              Select a finding to see its plans, approval and delivery.
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function NewFinding({
  onSubmit,
  pending,
}: {
  onSubmit: (d: {
    title: string;
    description: string;
    reference?: string;
    severity: (typeof SEVERITIES)[number];
  }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("high");
  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, description, reference: reference || undefined, severity });
      }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="sf-title">Title</Label>
        <Input id="sf-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={5} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sf-ref">Reference (CVE or control ID)</Label>
        <Input id="sf-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sf-sev">Severity</Label>
        <select
          id="sf-sev"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s} — fix within {SEVERITY_DAYS[s]} days
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="sf-desc">Description</Label>
        <Textarea id="sf-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Record finding
        </Button>
      </div>
    </form>
  );
}

type Finding = Awaited<ReturnType<typeof getSecurityBoard>>["findings"][number];
type Exception = Awaited<ReturnType<typeof getSecurityBoard>>["exceptions"][number];

function FindingDetail({
  finding: f,
  exceptions,
  changes,
  incidents,
  canApprove,
  canDecideException,
  userId,
  onChanged,
}: {
  finding: Finding;
  exceptions: Exception[];
  changes: { id: string; number: string; title: string }[];
  incidents: { id: string; number: string; title: string }[];
  canApprove: boolean;
  canDecideException: boolean;
  userId?: string;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    impactAssessment: f.impact_assessment ?? "",
    fixPlan: f.fix_plan ?? "",
    testPlan: f.test_plan ?? "",
    rollbackPlan: f.rollback_plan ?? "",
    rollbackTrigger: f.rollback_trigger ?? "",
    notes: "",
    windowStart: "",
    windowEnd: "",
    outcome: "successful",
    validationResults: "",
    reviewNotes: "",
    rollbackUsed: "false",
    justification: "",
    controls: "",
    expiresAt: "",
    exceptionNotes: "",
  });
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const step = useMutation({
    mutationFn: (s: TransitionInput) => transitionSecurityFinding({ data: { id: f.id, step: s } }),
    onSuccess: async () => {
      toast.success("Finding updated.");
      await onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });
  const reqException = useMutation({
    mutationFn: () =>
      requestSecurityException({
        data: {
          findingId: f.id,
          justification: form["justification"]!,
          compensatingControls: form["controls"]!,
          expiresAt: form["expiresAt"]!,
        },
      }),
    onSuccess: async () => {
      toast.success("Risk exception requested.");
      await onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Exception was not requested."),
  });
  const decideEx = useMutation({
    mutationFn: (i: { id: string; decision: "approved" | "rejected" }) =>
      decideSecurityException({ data: { ...i, notes: form["exceptionNotes"] } }),
    onSuccess: async () => {
      toast.success("Exception decision recorded.");
      await onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Decision failed."),
  });

  const plans: [string, string][] = [
    ["impactAssessment", "Impact assessment"],
    ["fixPlan", "Fix plan"],
    ["testPlan", "Test plan"],
    ["rollbackPlan", "Rollback plan"],
    ["rollbackTrigger", "Rollback trigger"],
  ];
  const editablePlans = f.state === "requested";
  const pendingEx = exceptions.find((e) => e.status === "requested");
  const busy = step.isPending;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-4">
      <header>
        <p className="font-mono text-xs text-muted-foreground">
          {f.number} · {f.source === "scanner" ? `Scanner: ${f.scanner_name}` : "Manual"}
          {f.reference ? ` · ${f.reference}` : ""}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">{f.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className={`mr-2 rounded px-1.5 py-0.5 capitalize ${SEV_CLASS[f.severity]}`}>{f.severity}</span>
          {STATE_TEXT[f.state]} · Due {formatDateTime(f.due_at)}
          {f.asset_key ? ` · Asset ${f.asset_key}` : ""}
        </p>
        {f.description ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{f.description}</p>
        ) : null}
      </header>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Assessment and plans</h3>
        {plans.map(([k, label]) =>
          editablePlans ? (
            <div key={k} className="space-y-1">
              <Label htmlFor={`p-${k}`}>{label}</Label>
              <Textarea id={`p-${k}`} rows={2} value={form[k]} onChange={set(k)} />
            </div>
          ) : (
            <div key={k} className="text-sm">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="whitespace-pre-wrap text-foreground">
                {(f as Record<string, unknown>)[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] as string || "—"}
              </p>
            </div>
          ),
        )}
        {editablePlans ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              step.mutate({
                action: "submit",
                impactAssessment: form["impactAssessment"]!,
                fixPlan: form["fixPlan"]!,
                testPlan: form["testPlan"]!,
                rollbackPlan: form["rollbackPlan"]!,
                rollbackTrigger: form["rollbackTrigger"]!,
              })
            }
          >
            Submit for approval
          </Button>
        ) : null}
      </section>

      {f.state === "pending_approval" ? (
        <section className="space-y-2 rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">Approval</h3>
          {canApprove ? (
            <>
              <Textarea rows={2} placeholder="Decision notes (required to reject)" value={form["notes"]} onChange={set("notes")} aria-label="Decision notes" />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => step.mutate({ action: "approve", notes: form["notes"] || undefined })}>
                  Approve fix
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => step.mutate({ action: "reject", notes: form["notes"]! })}>
                  Reject
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for a manager, change manager or admin other than the requester.
            </p>
          )}
        </section>
      ) : f.approved_at ? (
        <p className="text-xs text-muted-foreground">
          Decision recorded {formatDateTime(f.approved_at)}
          {f.approval_notes ? ` — ${f.approval_notes}` : ""}
        </p>
      ) : null}

      {f.state === "scheduled" ? (
        <section className="space-y-2 rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">Schedule</h3>
          {f.window_start ? (
            <p className="text-xs text-muted-foreground">
              Window {formatDateTime(f.window_start)} → {formatDateTime(f.window_end)}
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ws">Window start</Label>
              <Input id="ws" type="datetime-local" value={form["windowStart"]} onChange={set("windowStart")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="we">Window end</Label>
              <Input id="we" type="datetime-local" value={form["windowEnd"]} onChange={set("windowEnd")} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => step.mutate({ action: "schedule", windowStart: form["windowStart"]!, windowEnd: form["windowEnd"]! })}>
              Save window
            </Button>
            <Button size="sm" disabled={busy || !f.window_start} onClick={() => step.mutate({ action: "start" })}>
              Start remediation
            </Button>
          </div>
        </section>
      ) : null}

      {f.state === "remediating" ? (
        <section className="space-y-2 rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">Record delivery</h3>
          <select aria-label="Outcome" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={form["outcome"]} onChange={set("outcome")}>
            <option value="successful">Successful</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
          </select>
          <Textarea rows={2} placeholder="Validation results" aria-label="Validation results" value={form["validationResults"]} onChange={set("validationResults")} />
          <Textarea rows={2} placeholder="Review notes" aria-label="Review notes" value={form["reviewNotes"]} onChange={set("reviewNotes")} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form["rollbackUsed"] === "true"} onChange={(e) => setForm({ ...form, rollbackUsed: String(e.target.checked) })} />
            Rollback was used
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              step.mutate({
                action: "deliver",
                outcome: form["outcome"] as "successful",
                validationResults: form["validationResults"]!,
                reviewNotes: form["reviewNotes"]!,
                rollbackUsed: form["rollbackUsed"] === "true",
              })
            }
          >
            Mark delivered
          </Button>
        </section>
      ) : null}

      {f.state === "delivered" || f.state === "closed" ? (
        <section className="text-sm">
          <p className="text-xs text-muted-foreground">Delivery</p>
          <p className="text-foreground capitalize">
            {f.delivery_outcome} · {formatDateTime(f.delivered_at)} · Rollback {f.rollback_used ? "used" : "not used"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{f.validation_results}</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{f.review_notes}</p>
          {f.state === "delivered" ? (
            <Button className="mt-2" size="sm" disabled={busy} onClick={() => step.mutate({ action: "close" })}>
              Close finding
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2 rounded-md border border-border bg-background p-3">
        <h3 className="text-sm font-semibold text-foreground">Linked records</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <select aria-label="Linked change" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={f.change_id ?? ""} onChange={(e) => step.mutate({ action: "link", changeId: e.target.value })}>
            <option value="">No change linked</option>
            {changes.map((c) => (
              <option key={c.id} value={c.id}>{c.number} · {c.title}</option>
            ))}
          </select>
          <select aria-label="Linked incident" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={f.incident_id ?? ""} onChange={(e) => step.mutate({ action: "link", incidentId: e.target.value })}>
            <option value="">No incident linked</option>
            {incidents.map((c) => (
              <option key={c.id} value={c.id}>{c.number} · {c.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {f.change_id ? <Link to="/changes" search={{ record: f.change_id }} className="text-primary underline">Open change</Link> : null}
          {f.incident_id ? <Link to="/incidents" search={{ record: f.incident_id } as never} className="text-primary underline">Open incident</Link> : null}
          <Link to="/changes" className="text-primary underline">Raise a new change for this fix</Link>
        </div>
      </section>

      <section className="space-y-2 rounded-md border border-border bg-background p-3">
        <h3 className="text-sm font-semibold text-foreground">Risk exceptions</h3>
        {exceptions.length === 0 ? <p className="text-xs text-muted-foreground">No exceptions requested.</p> : null}
        <ul className="space-y-2 text-sm">
          {exceptions.map((e) => (
            <li key={e.id} className="rounded border border-border p-2">
              <p className="text-xs capitalize text-muted-foreground">
                {e.status} · expires {formatDateTime(e.expires_at)}
              </p>
              <p className="whitespace-pre-wrap text-foreground">{e.justification}</p>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">Controls: {e.compensating_controls}</p>
              {e.decision_notes ? <p className="text-xs text-muted-foreground">Decision: {e.decision_notes}</p> : null}
              {e.status === "requested" && canDecideException && e.requested_by !== userId ? (
                <div className="mt-2 space-y-2">
                  <Textarea rows={2} placeholder="Decision notes (required to reject)" aria-label="Exception decision notes" value={form["exceptionNotes"]} onChange={set("exceptionNotes")} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={decideEx.isPending} onClick={() => decideEx.mutate({ id: e.id, decision: "approved" })}>Approve exception</Button>
                    <Button size="sm" variant="outline" disabled={decideEx.isPending} onClick={() => decideEx.mutate({ id: e.id, decision: "rejected" })}>Reject</Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {OPEN.includes(f.state) && !pendingEx ? (
          <div className="space-y-2">
            <Textarea rows={2} placeholder="Business justification" aria-label="Exception justification" value={form["justification"]} onChange={set("justification")} />
            <Textarea rows={2} placeholder="Compensating controls" aria-label="Compensating controls" value={form["controls"]} onChange={set("controls")} />
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="ex-exp">Expires</Label>
                <Input id="ex-exp" type="date" value={form["expiresAt"]} onChange={set("expiresAt")} />
              </div>
              <Button size="sm" variant="outline" disabled={reqException.isPending} onClick={() => reqException.mutate()}>
                Request risk exception
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {OPEN.includes(f.state) ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => step.mutate({ action: "cancel" })}>
          Cancel finding
        </Button>
      ) : null}

      <RecordActivity recordType="security_finding" recordId={f.id} />
    </article>
  );
}
