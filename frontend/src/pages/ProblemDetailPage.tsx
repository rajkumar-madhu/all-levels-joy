import { ArrowLeft, Unlink } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useLinkIncident, useProblem, useUpdateProblem, type ProblemDetail, type ProblemUpdate } from "@/api/problems";
import type { RecordState } from "@/api/types";
import { IncidentStateBadge, PriorityBadge, RecordStateBadge } from "@/components/badges";
import { Badge, Button, Field, FormError, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";
import { PROBLEM_ROLES, hasAnyRole } from "@/lib/roles";

const STATES: RecordState[] = ["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"];

export function ProblemDetailPage() {
  const workspace = useWorkspace();
  const { problemId = "" } = useParams();
  const problem = useProblem(workspace.id, problemId);
  const canRun = hasAnyRole(workspace.roles, PROBLEM_ROLES);

  if (problem.isPending) return <StateMessage kind="loading">Loading problem…</StateMessage>;
  if (problem.isError) return <StateMessage kind="error">{problem.error.message}</StateMessage>;
  const p = problem.data;

  return (
    <>
      <Link to="/problems" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Problems
      </Link>
      <PageHeader title={`${p.number} · ${p.title}`} />
      <div className="flex flex-wrap gap-2">
        <RecordStateBadge state={p.state} />
        <PriorityBadge priority={p.priority} />
        {p.known_error && <Badge tone="warn">Known error</Badge>}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <Panel className="grid gap-4 p-5">
            <Section label="Description">{p.description}</Section>
            <Section label="Workaround">{p.workaround}</Section>
            <Section label="Root cause">{p.root_cause}</Section>
            <Section label="Fix plan">{p.fix_plan}</Section>
            <Section label="Resolution">{p.resolution_notes}</Section>
          </Panel>
          <LinkedIncidents problem={p} orgId={workspace.id} canRun={canRun} />
        </div>
        <div className="grid gap-6">
          <Panel className="p-4">
            <dl className="grid gap-3 text-sm">
              <Fact label="Assigned to">{p.assignee_name ?? "Unassigned"}</Fact>
              <Fact label="Service">{p.service_name ?? "—"}</Fact>
              <Fact label="Category">{humanize(p.category)}</Fact>
              <Fact label="Impact / urgency">{p.impact} / {p.urgency}</Fact>
              <Fact label="Known-error article">
                {p.knowledge_article_id ? (
                  <Link className="text-primary hover:underline" to={`/knowledge/${p.knowledge_article_id}`}>
                    {p.knowledge_article_number} · {p.knowledge_article_title}
                  </Link>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label="Opened">{formatDateTime(p.created_at)}</Fact>
              <Fact label="Resolved">{formatDateTime(p.resolved_at)}</Fact>
            </dl>
          </Panel>
          {/* Keyed on updated_at so the form resets to the saved values after each save. */}
          {canRun && <WorkPanel key={p.updated_at} problem={p} orgId={workspace.id} />}
        </div>
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{label}</h2>
      <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">{children || <span className="text-muted-foreground">Not recorded yet.</span>}</p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function WorkPanel({ problem: p, orgId }: { problem: ProblemDetail; orgId: string }) {
  const update = useUpdateProblem(orgId, p.id);
  const [state, setState] = useState<RecordState>(p.state);
  const closing = state === "resolved" || state === "closed";

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");
    const body: ProblemUpdate = { expectedUpdatedAt: p.updated_at };
    if (state !== p.state) body.state = state;
    const knownError = form.get("knownError") === "on";
    if (knownError !== p.known_error) body.knownError = knownError;
    for (const [key, field] of [
      ["workaround", "workaround"],
      ["rootCause", "root_cause"],
      ["fixPlan", "fix_plan"],
      ["resolutionNotes", "resolution_notes"],
    ] as const) {
      if (text(key).trim() !== (p[field] ?? "")) body[key] = text(key).trim() || null;
    }
    const impact = Number(text("impact"));
    const urgency = Number(text("urgency"));
    if (impact !== p.impact) body.impact = impact;
    if (urgency !== p.urgency) body.urgency = urgency;
    const article = text("article");
    if (article !== (p.knowledge_article_id ?? "")) body.knowledgeArticleId = article || null;
    update.mutate(body);
  };

  return (
    <Panel className="p-4">
      <form className="grid gap-3" onSubmit={submit}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Work this problem</h2>
          <Button type="button" variant="secondary" busy={update.isPending} onClick={() => update.mutate({ expectedUpdatedAt: p.updated_at, assignToMe: true })}>
            Assign to me
          </Button>
        </div>
        <Field label="State">
          <Select id="problem-state" value={state} onChange={(e) => setState(e.target.value as RecordState)}>
            {STATES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input id="problem-known-error" type="checkbox" name="knownError" defaultChecked={p.known_error} /> Known error (workaround available)
        </label>
        <Field label="Workaround">
          <Textarea id="problem-workaround" name="workaround" defaultValue={p.workaround ?? ""} maxLength={4000} rows={2} />
        </Field>
        <Field label="Root cause" hint={closing ? "Required to resolve or close." : undefined}>
          <Textarea id="problem-root-cause" name="rootCause" defaultValue={p.root_cause ?? ""} maxLength={4000} rows={2} required={closing} />
        </Field>
        <Field label="Fix plan">
          <Textarea id="problem-fix-plan" name="fixPlan" defaultValue={p.fix_plan ?? ""} maxLength={4000} rows={2} />
        </Field>
        <Field label="Resolution notes" hint={closing ? "Required to resolve or close." : undefined}>
          <Textarea id="problem-resolution" name="resolutionNotes" defaultValue={p.resolution_notes ?? ""} maxLength={4000} rows={2} required={closing} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Impact">
            <Select id="problem-edit-impact" name="impact" defaultValue={String(p.impact)}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Urgency">
            <Select id="problem-edit-urgency" name="urgency" defaultValue={String(p.urgency)}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Known-error article">
          <Select id="problem-article" name="article" defaultValue={p.knowledge_article_id ?? ""}>
            <option value="">No article</option>
            {p.articles.map((a) => <option key={a.id} value={a.id}>{a.number} — {a.title}</option>)}
          </Select>
        </Field>
        <FormError error={update.error} />
        <Button type="submit" busy={update.isPending}>Save</Button>
      </form>
    </Panel>
  );
}

function LinkedIncidents({ problem: p, orgId, canRun }: { problem: ProblemDetail; orgId: string; canRun: boolean }) {
  const link = useLinkIncident(orgId, p.id);
  const [incidentId, setIncidentId] = useState("");
  return (
    <Panel className="grid gap-3 p-5">
      <h2 className="text-sm font-semibold">Linked incidents</h2>
      {p.incidents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No incidents linked yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {p.incidents.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Link className="font-mono text-xs text-primary hover:underline" to={`/incidents/${i.id}`}>{i.number}</Link>
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              {i.major_incident && <Badge tone="bad">Major</Badge>}
              <IncidentStateBadge state={i.state} />
              {canRun && (
                <Button variant="secondary" busy={link.isPending} aria-label={`Unlink ${i.number}`} onClick={() => link.mutate({ incidentId: i.id, linked: false })}>
                  <Unlink className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canRun && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (incidentId) link.mutate({ incidentId, linked: true }, { onSuccess: () => setIncidentId("") });
          }}
        >
          <Select id="problem-link-incident" aria-label="Incident to link" className="min-w-0 flex-1" value={incidentId} onChange={(e) => setIncidentId(e.target.value)}>
            <option value="">Choose an incident to link…</option>
            {p.candidates.map((c) => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
          </Select>
          <Button type="submit" variant="secondary" busy={link.isPending} disabled={!incidentId}>Link incident</Button>
        </form>
      )}
      <FormError error={link.error} />
    </Panel>
  );
}
