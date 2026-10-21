import { clsx } from "clsx";
import { Headset, Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useIncidentQueue, useQueueCounts, useServices, useCreateOperatorIncident, type IncidentQueueName, type OperatorIncident, type QueueFilters } from "@/api/cmdb";
import { useCreateIncident, useGroups } from "@/api/hooks";
import { IncidentStateBadge, PriorityBadge } from "@/components/badges";
import { Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, formatDateTime } from "@/lib/format";
import { INCIDENT_CATEGORIES } from "@/lib/incident-workflow";

// Same queues as the existing workbench (src/lib/incident-queue.ts).
const QUEUES: { value: IncidentQueueName; label: string; hint: string }[] = [
  { value: "active", label: "Active", hint: "All work awaiting resolution" },
  { value: "mine", label: "Assigned to me", hint: "Your active incidents" },
  { value: "unassigned", label: "Unassigned", hint: "Active incidents without an owner" },
  { value: "at_risk", label: "Due within 1h", hint: "Active resolution targets due within an hour" },
  { value: "breached", label: "Breached", hint: "Active incidents past their resolution target" },
  { value: "completed", label: "Resolved", hint: "Resolved and closed incidents" },
  { value: "all", label: "All records", hint: "Includes cancelled and completed work" },
];
const DEFAULTS: QueueFilters = { queue: "active", q: "", priority: "all", group: "all", service: "all", sort: "sla", page: 1 };

function useQueueParams() {
  const [params, setParams] = useSearchParams();
  const filters: QueueFilters = {
    queue: (QUEUES.find((q) => q.value === params.get("queue"))?.value ?? DEFAULTS.queue) as IncidentQueueName,
    q: params.get("q") ?? "",
    priority: params.get("priority") ?? "all",
    group: params.get("group") ?? "all",
    service: params.get("service") ?? "all",
    sort: (params.get("sort") as QueueFilters["sort"]) ?? "sla",
    page: Math.max(1, Number(params.get("page") ?? 1) || 1),
  };
  // Every filter change returns to page 1; only the pager moves pages.
  const update = (next: Partial<QueueFilters>) => {
    const merged = { ...filters, page: 1, ...next };
    const out = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (String(value) !== String(DEFAULTS[key as keyof QueueFilters])) out.set(key, String(value));
    }
    setParams(out, { replace: true });
  };
  return { filters, update };
}

export function IncidentsPage() {
  const workspace = useWorkspace();
  const { filters, update } = useQueueParams();
  const [draft, setDraft] = useState(filters.q);
  const [form, setForm] = useState<"self" | "operator" | null>(null);
  const queue = useIncidentQueue(workspace.id, filters);
  const counts = useQueueCounts(workspace.id);
  const groups = useGroups(workspace.id, workspace.is_staff);
  const services = useServices(workspace.id);
  const current = QUEUES.find((q) => q.value === filters.queue)!;
  const pages = queue.data ? Math.max(1, Math.ceil(queue.data.total / queue.data.page_size)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="ITSM"
        title="Incidents"
        description={workspace.is_staff ? "Triage incoming work, protect service targets, and keep every resolution accountable." : "Tickets you have raised."}
        actions={
          <>
            {workspace.is_staff && (
              <Button variant="secondary" onClick={() => setForm((f) => (f === "operator" ? null : "operator"))}>
                <Headset className="size-4" /> Log an incident
              </Button>
            )}
            <Button onClick={() => setForm((f) => (f === "self" ? null : "self"))}>
              <Plus className="size-4" /> Report an issue
            </Button>
          </>
        }
      />
      {form === "self" && <NewIncidentForm orgId={workspace.id} onDone={() => setForm(null)} />}
      {form === "operator" && <OperatorIncidentForm orgId={workspace.id} onDone={() => setForm(null)} />}

      <Panel>
        <div className="border-b border-border px-4 pt-3">
          <h2 className="text-sm font-semibold">Work queues</h2>
          <p className="text-xs text-muted-foreground">Counts cover all records you can access. Filters apply to the list below.</p>
          <div role="tablist" aria-label="Incident queues" className="-mb-px mt-2 flex gap-1 overflow-x-auto">
            {QUEUES.map((q) => (
              <button
                key={q.value}
                role="tab"
                aria-selected={q.value === filters.queue}
                title={q.hint}
                onClick={() => update({ queue: q.value })}
                className={clsx(
                  "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                  q.value === filters.queue ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {q.label}
                <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{counts.data?.[q.value] ?? "…"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <form
            className="flex min-w-60 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: draft.trim() });
            }}
          >
            <Input id="incident-search" aria-label="Search incident number or title" placeholder="Search incident number or title" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button variant="secondary" type="submit" aria-label="Search">
              <Search className="size-4" />
            </Button>
          </form>
          <Select id="queue-priority" aria-label="Priority" className="w-36!" value={filters.priority} onChange={(e) => update({ priority: e.target.value })}>
            <option value="all">All priorities</option>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={String(p)}>P{p}</option>)}
          </Select>
          {workspace.is_staff && (
            <Select id="queue-group" aria-label="Group" className="w-44!" value={filters.group} onChange={(e) => update({ group: e.target.value })}>
              <option value="all">All groups</option>
              <option value="unassigned">No group</option>
              {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          )}
          <Select id="queue-service" aria-label="Service" className="w-44!" value={filters.service} onChange={(e) => update({ service: e.target.value })}>
            <option value="all">All services</option>
            {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select id="queue-sort" aria-label="Sort" className="w-40!" value={filters.sort} onChange={(e) => update({ sort: e.target.value as QueueFilters["sort"] })}>
            <option value="sla">SLA due first</option>
            <option value="priority">Highest priority</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </Select>
        </div>

        <div className="px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{current.label}</span> · {queue.data ? `${queue.data.total} matching incidents` : "Loading…"}
        </div>
        {queue.isPending ? (
          <div className="p-4"><StateMessage kind="loading">Loading incidents…</StateMessage></div>
        ) : queue.isError ? (
          <div className="p-4"><StateMessage kind="error">{queue.error.message}</StateMessage></div>
        ) : queue.data.results.length === 0 ? (
          <div className="p-4"><StateMessage kind="empty">No incidents in {current.label.toLowerCase()} match these filters.</StateMessage></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-y border-border">
                  <th className={th}>Incident</th>
                  <th className={th}>Priority / state</th>
                  <th className={th}>Owner / group</th>
                  <th className={th}>Resolution SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {queue.data.results.map((i) => {
                  const due = dueIn(i.sla_due_at);
                  const done = ["resolved", "closed", "cancelled"].includes(i.state);
                  return (
                    <tr key={i.id} className="hover:bg-accent">
                      <td className="px-4 py-2.5">
                        <Link className="font-mono text-xs text-primary hover:underline" to={`/incidents/${i.id}`}>{i.number}</Link>
                        <p className="max-w-[28rem] truncate">{i.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {i.service_name ?? "No service"} · {formatDateTime(i.created_at)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <PriorityBadge priority={i.priority} />
                          <IncidentStateBadge state={i.state} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <p>{i.assignee_name ?? (i.assignee_id ? "A support agent" : "Unassigned")}</p>
                        <p className="text-xs text-muted-foreground">{i.group_name ?? "No group"}</p>
                      </td>
                      <td className={clsx("px-4 py-2.5 tabular-nums", !done && due.overdue && "text-destructive")}>
                        {done ? "—" : due.label}
                        <p className="text-xs text-muted-foreground">{formatDateTime(i.sla_due_at)}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {queue.data && pages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm">
            <span className="text-muted-foreground">Page {filters.page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>Previous</Button>
              <Button variant="secondary" disabled={filters.page >= pages} onClick={() => update({ page: filters.page + 1 })}>Next</Button>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}

function NewIncidentForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const create = useCreateIncident(orgId);
  const [created, setCreated] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate(
      {
        title: String(form.get("title")),
        description: String(form.get("description")),
        impact: Number(form.get("impact")),
        urgency: Number(form.get("urgency")),
        category: String(form.get("category") ?? ""),
      },
      { onSuccess: (r) => setCreated(r.number) },
    );
  };

  if (created)
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <p>
          <span className="font-mono">{created}</span> was raised. The service desk will pick it up.
        </p>
        <Button variant="secondary" onClick={onDone}>Close</Button>
      </Panel>
    );

  return (
    <Panel className="p-4">
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <div className="md:col-span-2">
          <Field label="Summary">
            <Input id="incident-title" name="title" required minLength={5} maxLength={160} placeholder="VPN disconnects every hour" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="What is happening?" hint="Include when it started and who is affected.">
            <Textarea id="incident-description" name="description" required minLength={5} maxLength={6000} />
          </Field>
        </div>
        <Field label="Impact">
          <Select id="incident-impact" name="impact" defaultValue="3">
            <option value="1">1 — Many people or a critical service</option>
            <option value="2">2 — A team or an important service</option>
            <option value="3">3 — Just me</option>
          </Select>
        </Field>
        <Field label="Urgency">
          <Select id="incident-urgency" name="urgency" defaultValue="3">
            <option value="1">1 — Work has stopped</option>
            <option value="2">2 — Work is slowed down</option>
            <option value="3">3 — I can work around it</option>
          </Select>
        </Field>
        <Field label="Category">
          <Select id="incident-category" name="category" defaultValue="">
            <option value="">Not sure</option>
            {INCIDENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <div className="flex items-end justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" busy={create.isPending}>Raise incident</Button>
        </div>
        <div className="md:col-span-2"><FormError error={create.error} /></div>
      </form>
    </Panel>
  );
}

/** Staff log an incident taken by phone, email or at the desk, already routed. */
function OperatorIncidentForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const create = useCreateOperatorIncident(orgId);
  const groups = useGroups(orgId, true);
  const services = useServices(orgId);
  const [category, setCategory] = useState("");
  const subcategories = INCIDENT_CATEGORIES.find((c) => c.value === category)?.subcategories ?? [];

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "");
    create.mutate({
      title: text("title"),
      description: text("description"),
      impact: Number(text("impact")),
      urgency: Number(text("urgency")),
      groupId: text("group") || null,
      serviceId: text("service") || null,
      category: category || null,
      subcategory: text("subcategory") || null,
      contactType: text("contactType") as OperatorIncident["contactType"],
    });
  };

  if (create.data)
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <p>
          <Link className="font-mono text-primary underline" to={`/incidents/${create.data.id}`}>{create.data.number}</Link> was logged.
        </p>
        <Button variant="secondary" onClick={onDone}>Close</Button>
      </Panel>
    );

  return (
    <Panel className="p-4">
      <form className="grid gap-4 md:grid-cols-3" onSubmit={submit}>
        <div className="md:col-span-3">
          <Field label="Summary">
            <Input id="operator-title" name="title" required minLength={5} maxLength={160} placeholder="Caller reports checkout failures" />
          </Field>
        </div>
        <div className="md:col-span-3">
          <Field label="Description">
            <Textarea id="operator-description" name="description" required minLength={5} maxLength={6000} />
          </Field>
        </div>
        <Field label="Contact type">
          <Select id="operator-contact" name="contactType" defaultValue="phone">
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="walk_up">Walk-up</option>
            <option value="chat">Chat</option>
            <option value="self_service">Self-service</option>
          </Select>
        </Field>
        <Field label="Impact">
          <Select id="operator-impact" name="impact" defaultValue="3">
            <option value="1">1 — High</option>
            <option value="2">2 — Medium</option>
            <option value="3">3 — Low</option>
          </Select>
        </Field>
        <Field label="Urgency">
          <Select id="operator-urgency" name="urgency" defaultValue="3">
            <option value="1">1 — High</option>
            <option value="2">2 — Medium</option>
            <option value="3">3 — Low</option>
          </Select>
        </Field>
        <Field label="Assignment group">
          <Select id="operator-group" name="group" defaultValue="">
            <option value="">Route automatically</option>
            {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label="Service">
          <Select id="operator-service" name="service" defaultValue="">
            <option value="">Not known</option>
            {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select id="operator-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Not sure</option>
              {INCIDENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Subcategory">
            <Select id="operator-subcategory" name="subcategory" defaultValue="" disabled={!subcategories.length}>
              <option value="">—</option>
              {subcategories.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-2 md:col-span-3">
          <FormError error={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
            <Button type="submit" busy={create.isPending}>Log incident</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
