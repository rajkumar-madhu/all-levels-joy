import { Radio, Siren, TimerOff } from "lucide-react";
import { clsx } from "clsx";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useCommandCenter, useDeclareMajorIncident, usePostBridgeUpdate, useUpdateMajorIncident } from "@/api/hooks";
import type { BridgeState, CommandCenter, MajorIncident } from "@/api/types";
import { IncidentStateBadge } from "@/components/badges";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, relativeTime, safeHttpUrl } from "@/lib/format";
import { MAJOR_INCIDENT_ROLES, hasAnyRole } from "@/lib/roles";

// Same labels as the existing app (src/lib/itsm-shared.ts).
const BRIDGE_STATES: Record<BridgeState, string> = {
  declared: "Declared",
  investigating: "Investigating",
  mitigating: "Mitigating",
  monitoring: "Monitoring",
  resolved: "Resolved",
};
const SEVERITY_LABELS: Record<number, string> = {
  1: "Sev 1 — critical outage",
  2: "Sev 2 — major degradation",
  3: "Sev 3 — limited impact",
};
const UPDATE_TYPES: Record<string, string> = {
  declaration: "Declaration",
  status: "Status",
  action: "Action",
  escalation: "Escalation",
  comms: "Communication",
  resolution: "Resolution",
};
const AUDIENCES: Record<string, string> = { internal: "Internal", customer: "Customer", executive: "Executive" };

const isOverdue = (m: MajorIncident) => m.bridge_state !== "resolved" && !!m.next_update_at && Date.parse(m.next_update_at) < Date.now();

export function CommandCenterPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [declaring, setDeclaring] = useState(false);
  const center = useCommandCenter(workspace.id, workspace.is_staff);
  const canRun = hasAnyRole(workspace.roles, MAJOR_INCIDENT_ROLES);

  if (!workspace.is_staff) return <StateMessage kind="error">Major incident command is available to workspace staff only.</StateMessage>;

  const majors = center.data?.majors ?? [];
  const active = majors.filter((m) => m.bridge_state !== "resolved");
  const selected = majors.find((m) => m.id === params.get("record")) ?? active[0] ?? majors[0] ?? null;
  const select = (id: string) => setParams({ record: id }, { replace: true });

  return (
    <>
      <PageHeader
        eyebrow="ITSM"
        title="Major incident command"
        description="Declare major incidents, run the bridge, post stakeholder updates, escalate, and hand off to a problem investigation."
        actions={
          canRun && (
            <Button variant={declaring ? "secondary" : "danger"} onClick={() => setDeclaring((v) => !v)}>
              <Siren className="size-4" /> {declaring ? "Cancel" : "Declare major incident"}
            </Button>
          )
        }
      />

      {center.isPending ? (
        <StateMessage kind="loading">Loading the command bridge…</StateMessage>
      ) : center.isError ? (
        <StateMessage kind="error">{center.error.message}</StateMessage>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Active bridges" value={active.length} icon={Radio} />
            <Kpi label="Severity 1 active" value={active.filter((m) => m.severity === 1).length} icon={Siren} alert />
            <Kpi label="Updates overdue" value={active.filter(isOverdue).length} icon={TimerOff} alert />
          </div>

          {declaring && canRun && (
            <DeclareForm
              orgId={workspace.id}
              candidates={center.data.candidates}
              onDeclared={(id) => {
                setDeclaring(false);
                select(id);
              }}
            />
          )}

          {majors.length === 0 ? (
            <StateMessage kind="empty">No major incidents declared. Declare one from an active incident when an outage needs a bridge.</StateMessage>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <ul className="grid gap-2" aria-label="Major incidents">
                {majors.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => select(m.id)}
                      aria-current={m.id === selected?.id ? "true" : undefined}
                      className={clsx(
                        "w-full rounded-md border p-4 text-left transition-colors",
                        m.id === selected?.id ? "border-primary/50 bg-accent" : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{m.number}</span>
                        <span>{relativeTime(m.declared_at)}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium">{m.incident_title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone="bad">Sev {m.severity}</Badge>
                        <Badge tone={m.bridge_state === "resolved" ? "good" : "neutral"}>{BRIDGE_STATES[m.bridge_state]}</Badge>
                        {isOverdue(m) && <Badge tone="warn">Update due</Badge>}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Commander {m.commander_name ?? "unassigned"} · escalation L{m.escalation_level}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && <Bridge key={selected.id} major={selected} center={center.data} orgId={workspace.id} canRun={canRun} />}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Kpi({ label, value, icon: Icon, alert }: { label: string; value: number; icon: typeof Radio; alert?: boolean }) {
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p className={clsx("mt-2 text-2xl font-semibold tabular-nums", alert && value > 0 && "text-destructive")}>{value}</p>
    </Panel>
  );
}

function DeclareForm({ orgId, candidates, onDeclared }: { orgId: string; candidates: CommandCenter["candidates"]; onDeclared: (id: string) => void }) {
  const declare = useDeclareMajorIncident(orgId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    declare.mutate(
      {
        incidentId: text("incident"),
        severity: Number(text("severity")),
        situationSummary: text("summary"),
        customerImpact: text("impact") || undefined,
        bridgeUrl: text("bridge") || undefined,
        nextUpdateMinutes: Number(text("cadence")),
      },
      { onSuccess: (major) => onDeclared(major.id) },
    );
  };
  return (
    <Panel className="p-5">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2">
          <Field label="Incident">
            <Select id="mi-incident" name="incident" required defaultValue="">
              <option value="" disabled>Choose an active incident…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.number} — {c.title}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Severity">
          <Select id="mi-severity" name="severity" defaultValue="1">
            {[1, 2, 3].map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Update cadence (minutes)">
          <Input id="mi-cadence" name="cadence" type="number" min={5} max={480} defaultValue={30} required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Situation summary">
            <Textarea id="mi-summary" name="summary" rows={3} minLength={10} maxLength={4000} required />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Customer impact">
            <Textarea id="mi-impact" name="impact" rows={2} maxLength={2000} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Bridge link" hint="An http(s) meeting link.">
            <Input id="mi-bridge" name="bridge" type="url" maxLength={500} placeholder="https://meet.example.com/major-incident" />
          </Field>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <FormError error={declare.error} />
          <div>
            <Button type="submit" variant="danger" busy={declare.isPending}>Declare and take command</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

function Bridge({ major: m, center, orgId, canRun }: { major: MajorIncident; center: CommandCenter; orgId: string; canRun: boolean }) {
  const update = useUpdateMajorIncident(orgId);
  const post = usePostBridgeUpdate(orgId);
  const [body, setBody] = useState("");
  const timeline = center.updates.filter((u) => u.major_incident_id === m.id);
  const bridgeLink = safeHttpUrl(m.bridge_url);
  const nextLevel = Math.min(4, m.escalation_level + 1);
  const resolved = m.bridge_state === "resolved";

  return (
    <section className="grid gap-5">
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-muted-foreground">
            {m.number} ·{" "}
            <Link className="text-primary hover:underline" to={`/incidents/${m.incident_id}`}>{m.incident_number}</Link>
          </p>
          <IncidentStateBadge state={m.incident_state} />
        </div>
        <h2 className="mt-1 text-lg font-semibold">{m.incident_title}</h2>
        <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{m.situation_summary ?? "No situation summary recorded yet."}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Commander">{m.commander_name ?? "Unassigned"}</Fact>
          <Fact label="Communications lead">{m.comms_lead_name ?? "Unassigned"}</Fact>
          <Fact label="Declared">{formatDateTime(m.declared_at)}</Fact>
          <Fact label="Next update due">
            {m.next_update_at ? (
              <span className={clsx(isOverdue(m) && "font-medium text-destructive")}>
                {formatDateTime(m.next_update_at)} ({relativeTime(m.next_update_at)})
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Customer impact">{m.customer_impact ?? "Not recorded"}</Fact>
          <Fact label="Bridge">
            {bridgeLink ? (
              <a className="break-all text-primary underline" href={bridgeLink} target="_blank" rel="noreferrer noopener">{bridgeLink}</a>
            ) : (
              (m.bridge_url ?? "No bridge link")
            )}
          </Fact>
          <Fact label="Problem">{m.problem_number ?? "Not linked"}</Fact>
          <Fact label="Escalation">Level {m.escalation_level}</Fact>
        </dl>

        {canRun && (
          <div className="mt-5 grid gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Bridge state"
                className="w-44!"
                value={m.bridge_state}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ id: m.id, bridgeState: e.target.value as BridgeState })}
              >
                {Object.entries(BRIDGE_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              <Button variant="secondary" busy={update.isPending} onClick={() => update.mutate({ id: m.id, takeCommand: true })}>
                Take command
              </Button>
              <Button variant="secondary" busy={update.isPending} onClick={() => update.mutate({ id: m.id, takeComms: true })}>
                Take comms
              </Button>
              <Button
                variant="secondary"
                busy={update.isPending}
                disabled={m.escalation_level >= 4}
                onClick={() => update.mutate({ id: m.id, escalationLevel: nextLevel })}
              >
                {m.escalation_level >= 4 ? "At top escalation (L4)" : `Escalate to L${nextLevel}`}
              </Button>
              <Select
                aria-label="Link a problem"
                className="w-72! max-w-full"
                value={m.problem_id ?? ""}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ id: m.id, problemId: e.target.value || null })}
              >
                <option value="">No problem linked</option>
                {center.problems.map((p) => <option key={p.id} value={p.id}>{p.number} — {p.title}</option>)}
              </Select>
            </div>
            {resolved && (
              <p className="text-xs text-muted-foreground">
                The bridge is resolved. Resolve <Link className="text-primary underline" to={`/incidents/${m.incident_id}`}>{m.incident_number}</Link>{" "}
                separately with its resolution notes and close code.
              </p>
            )}
            <FormError error={update.error} />
          </div>
        )}
      </Panel>

      {canRun && !resolved && (
        <Panel className="p-5">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const cadence = Number(form.get("cadence"));
              post.mutate(
                {
                  id: m.id,
                  body: body.trim(),
                  updateType: String(form.get("type")),
                  audience: String(form.get("audience")),
                  ...(cadence ? { nextUpdateMinutes: cadence } : {}),
                },
                { onSuccess: () => setBody("") },
              );
            }}
          >
            <h3 className="text-sm font-semibold">Post a bridge update</h3>
            <Textarea id="mi-update" aria-label="Update" value={body} onChange={(e) => setBody(e.target.value)} minLength={3} maxLength={4000} rows={3} required />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Type">
                <Select id="mi-update-type" name="type" defaultValue="status">
                  {Object.entries(UPDATE_TYPES).filter(([v]) => v !== "declaration").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Audience">
                <Select id="mi-update-audience" name="audience" defaultValue="internal">
                  {Object.entries(AUDIENCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Next update in (minutes)">
                <Input id="mi-update-cadence" name="cadence" type="number" min={5} max={480} defaultValue={30} />
              </Field>
            </div>
            <FormError error={post.error} />
            <div>
              <Button type="submit" busy={post.isPending} disabled={body.trim().length < 3}>Post update</Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel className="p-5">
        <h3 className="text-sm font-semibold">Timeline</h3>
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No updates yet.</p>
        ) : (
          <ol className="mt-3 grid gap-4 border-l border-border pl-4">
            {timeline.map((u) => (
              <li key={u.id} className="relative">
                <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone={u.update_type === "escalation" ? "warn" : u.update_type === "resolution" ? "good" : "neutral"}>
                    {UPDATE_TYPES[u.update_type] ?? u.update_type}
                  </Badge>
                  <Badge tone={u.audience === "internal" ? "muted" : "info"}>{AUDIENCES[u.audience]}</Badge>
                  <span>{u.author_name ?? "Someone"}</span>
                  <span>{formatDateTime(u.created_at)}</span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{u.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
