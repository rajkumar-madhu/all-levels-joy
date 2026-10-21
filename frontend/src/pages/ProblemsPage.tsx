import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCreateProblem, useProblems } from "@/api/problems";
import { PriorityBadge, RecordStateBadge } from "@/components/badges";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime } from "@/lib/format";
import { PROBLEM_ROLES, hasAnyRole } from "@/lib/roles";

const VIEWS = [
  { value: "open", label: "Open", filters: { state: "new,open,in_progress,pending" } },
  { value: "known", label: "Known errors", filters: { knownError: true } },
  { value: "all", label: "All", filters: {} },
] as const;

export function ProblemsPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.value === params.get("view")) ?? VIEWS[0];
  const [creating, setCreating] = useState(false);
  const canRun = hasAnyRole(workspace.roles, PROBLEM_ROLES);
  const problems = useProblems(workspace.id, view.filters, workspace.is_staff);

  if (!workspace.is_staff) return <StateMessage kind="error">Problem management is available to workspace staff only.</StateMessage>;

  return (
    <>
      <PageHeader
        eyebrow="ITSM"
        title="Problems"
        description="Find the root cause behind recurring incidents, record workarounds as known errors, and track the permanent fix."
        actions={
          canRun && (
            <Button onClick={() => setCreating((v) => !v)}>
              <Plus className="size-4" /> {creating ? "Cancel" : "New problem"}
            </Button>
          )
        }
      />
      {creating && problems.data && (
        <NewProblemForm orgId={workspace.id} services={problems.data.services} onCreated={(id) => navigate(`/problems/${id}`)} />
      )}

      <div role="group" aria-label="Filter problems" className="flex w-fit rounded-md border border-input">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            aria-pressed={view.value === v.value}
            onClick={() => setParams({ view: v.value }, { replace: true })}
            className="px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {v.label}
          </button>
        ))}
      </div>

      {problems.isPending ? (
        <StateMessage kind="loading">Loading problems…</StateMessage>
      ) : problems.isError ? (
        <StateMessage kind="error">{problems.error.message}</StateMessage>
      ) : problems.data.results.length === 0 ? (
        <StateMessage kind="empty">No problems in this view.</StateMessage>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Number</th>
                <th className={th}>Title</th>
                <th className={th}>Priority</th>
                <th className={th}>State</th>
                <th className={th}>Incidents</th>
                <th className={th}>Assigned to</th>
                <th className={th}>Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {problems.data.results.map((p) => (
                <tr key={p.id} className="hover:bg-accent">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link className="text-primary hover:underline" to={`/problems/${p.id}`}>{p.number}</Link>
                  </td>
                  <td className="max-w-80 px-4 py-2">
                    <span className="line-clamp-1">{p.title}</span>
                    {p.known_error && <Badge tone="warn">Known error</Badge>}
                  </td>
                  <td className="px-4 py-2"><PriorityBadge priority={p.priority} /></td>
                  <td className="px-4 py-2"><RecordStateBadge state={p.state} /></td>
                  <td className="px-4 py-2 tabular-nums">{p.incident_count}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p.assignee_name ?? "Unassigned"}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

function NewProblemForm({ orgId, services, onCreated }: { orgId: string; services: { id: string; name: string }[]; onCreated: (id: string) => void }) {
  const create = useCreateProblem(orgId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    create.mutate(
      {
        title: text("title"),
        description: text("description"),
        impact: Number(text("impact")),
        urgency: Number(text("urgency")),
        category: text("category") || undefined,
        serviceId: text("service") || null,
        assignToMe: form.get("assignToMe") === "on",
      },
      { onSuccess: (r) => onCreated(r.id) },
    );
  };
  return (
    <Panel className="p-5">
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <div className="md:col-span-2">
          <Field label="Title">
            <Input id="problem-title" name="title" required minLength={5} maxLength={160} placeholder="Recurring 502s after deploys" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="What keeps happening?" hint="Symptoms, when they started, and which incidents point to it.">
            <Textarea id="problem-description" name="description" required minLength={5} maxLength={6000} rows={3} />
          </Field>
        </div>
        <Field label="Impact">
          <Select id="problem-impact" name="impact" defaultValue="2">
            <option value="1">1 — High</option>
            <option value="2">2 — Medium</option>
            <option value="3">3 — Low</option>
          </Select>
        </Field>
        <Field label="Urgency">
          <Select id="problem-urgency" name="urgency" defaultValue="2">
            <option value="1">1 — High</option>
            <option value="2">2 — Medium</option>
            <option value="3">3 — Low</option>
          </Select>
        </Field>
        <Field label="Service">
          <Select id="problem-service" name="service" defaultValue="">
            <option value="">Not linked to a service</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Input id="problem-category" name="category" maxLength={40} placeholder="network" />
        </Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input id="problem-assign" type="checkbox" name="assignToMe" defaultChecked /> Assign to me
        </label>
        <div className="grid gap-2 md:col-span-2">
          <FormError error={create.error} />
          <div>
            <Button type="submit" busy={create.isPending}>Create problem</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
