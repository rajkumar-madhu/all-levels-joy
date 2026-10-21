import { Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useCreateIncident, useIncidents } from "@/api/hooks";
import { IncidentStateBadge, PriorityBadge } from "@/components/badges";
import { Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, formatDateTime } from "@/lib/format";

const FILTERS = [
  { value: "new,open,in_progress,pending", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "", label: "All" },
];

export function IncidentsPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const state = params.get("state") ?? FILTERS[0]!.value;
  const q = params.get("q") ?? "";
  const [draftQuery, setDraftQuery] = useState(q);
  const [creating, setCreating] = useState(false);
  const incidents = useIncidents(workspace.id, { state: state === "all" ? "" : state, q });

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v);
      else merged.delete(k);
    }
    setParams(merged, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Incidents"
        description={workspace.is_staff ? "The workspace incident queue." : "Tickets you have raised."}
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" /> Report an issue
          </Button>
        }
      />
      {creating && <NewIncidentForm orgId={workspace.id} onDone={() => setCreating(false)} />}

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by state" className="flex rounded-md border border-slate-300 dark:border-slate-700">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => update({ state: f.value || "all" })}
              aria-pressed={state === (f.value || "all")}
              className="px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md aria-pressed:bg-brand-600 aria-pressed:text-white"
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: draftQuery.trim() });
          }}
        >
          <Input id="incident-search" aria-label="Search incidents" placeholder="Search by number or title" value={draftQuery} onChange={(e) => setDraftQuery(e.target.value)} />
          <Button variant="secondary" type="submit" aria-label="Search">
            <Search className="size-4" />
          </Button>
        </form>
      </div>

      {incidents.isPending ? (
        <StateMessage kind="loading">Loading incidents…</StateMessage>
      ) : incidents.isError ? (
        <StateMessage kind="error">{incidents.error.message}</StateMessage>
      ) : incidents.data.length === 0 ? (
        <StateMessage kind="empty">No incidents match these filters.</StateMessage>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">SLA target</th>
                <th className="px-4 py-2 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {incidents.data.map((i) => {
                const due = dueIn(i.sla_due_at);
                const done = ["resolved", "closed", "cancelled"].includes(i.state);
                return (
                  <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link className="text-brand-600 hover:underline dark:text-brand-100" to={`/incidents/${i.id}`}>
                        {i.number}
                      </Link>
                    </td>
                    <td className="max-w-80 truncate px-4 py-2">{i.title}</td>
                    <td className="px-4 py-2"><PriorityBadge priority={i.priority} /></td>
                    <td className="px-4 py-2"><IncidentStateBadge state={i.state} /></td>
                    <td className={`px-4 py-2 tabular-nums ${!done && due.overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                      {done ? "—" : due.label}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">{formatDateTime(i.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
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
            <option value="hardware">Hardware</option>
            <option value="software">Software</option>
            <option value="network">Network</option>
            <option value="access">Access</option>
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
