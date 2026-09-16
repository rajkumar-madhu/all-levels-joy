import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PriorityBadge, SlaBadge, StateBadge } from "@/components/status-badge";
import { RecordActivity } from "@/components/record-activity";
import { createIncident, updateIncident } from "@/lib/itsm.functions";
import { referenceQuery } from "@/lib/workspace-queries";
import {
  CLOSE_CODES,
  CONTACT_TYPES,
  HOLD_REASONS,
  IMPACT_URGENCY_LABELS,
  INCIDENT_CATEGORIES,
  RECORD_STATES,
  STATE_LABELS,
  canManage,
  categoryLabel,
  formatDateTime,
  labelOf,
  type AppRole,
  type RecordState,
} from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/incidents")({
  validateSearch: z.object({ record: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Incidents — WeCrew ITSM" },
      {
        name: "description",
        content: "Log, triage, assign, and resolve incidents with impact and urgency driven priority.",
      },
      { property: "og:title", content: "Incidents — WeCrew ITSM" },
      { property: "og:description", content: "Incident queue with SLA timers and resolution evidence." },
    ],
  }),
  component: Incidents,
});

function Incidents() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    impact: 2,
    urgency: 2,
    serviceId: "",
    groupId: "",
    category: "",
    subcategory: "",
    contactType: "self_service",
  });
  const [resolution, setResolution] = useState("");
  const [closeCode, setCloseCode] = useState("solved_permanently");
  const [holdReason, setHoldReason] = useState("awaiting_caller");
  const subcategories =
    INCIDENT_CATEGORIES.find((item) => item.value === form.category)?.subcategories ?? [];

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const manager = canManage(roles);
  const incidents = data?.incidents ?? [];
  const selected = incidents.find((item) => item.id === search.record) ?? null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    await queryClient.invalidateQueries({ queryKey: ["incident-metrics"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createIncident({
        data: {
          title: form.title,
          description: form.description,
          impact: form.impact,
          urgency: form.urgency,
          serviceId: form.serviceId || null,
          groupId: form.groupId || null,
          category: form.category || null,
          subcategory: form.subcategory || null,
          contactType: form.contactType || null,
        },
      }),
    onSuccess: async (incident) => {
      toast.success(`Incident ${incident.number} logged.`);
      setCreating(false);
      setForm({
        title: "",
        description: "",
        impact: 2,
        urgency: 2,
        serviceId: "",
        groupId: "",
        category: "",
        subcategory: "",
        contactType: "self_service",
      });
      await refresh();
      void navigate({ to: "/incidents", search: { record: incident.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The incident was not logged."),
  });

  const update = useMutation({
    mutationFn: (input: {
      id: string;
      state?: RecordState;
      assignToMe?: boolean;
      resolutionNotes?: string;
      onHoldReason?: string | null;
      closeCode?: string | null;
      category?: string | null;
      subcategory?: string | null;
    }) => updateIncident({ data: input }),
    onSuccess: async () => {
      toast.success("Incident updated.");
      setResolution("");
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That update was not applied."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Service operations"
        title="Incidents"
        description="Priority is derived from impact and urgency. SLA targets start the moment an incident is logged."
        actions={
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? "Cancel" : "Log incident"}
          </Button>
        }
      />

      {creating ? (
        <form
          className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="title">Short description</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
              minLength={5}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">What is happening</Label>
            <Textarea
              id="description"
              rows={4}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              required
              minLength={5}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="impact">Impact</Label>
            <select
              id="impact"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.impact}
              onChange={(event) => setForm({ ...form, impact: Number(event.target.value) })}
            >
              {[1, 2, 3].map((value) => (
                <option key={value} value={value}>
                  {IMPACT_URGENCY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="urgency">Urgency</Label>
            <select
              id="urgency"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.urgency}
              onChange={(event) => setForm({ ...form, urgency: Number(event.target.value) })}
            >
              {[1, 2, 3].map((value) => (
                <option key={value} value={value}>
                  {IMPACT_URGENCY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service">Affected service</Label>
            <select
              id="service"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.serviceId}
              onChange={(event) => setForm({ ...form, serviceId: event.target.value })}
            >
              <option value="">Not sure</option>
              {(reference.data?.services ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group">Assignment group</Label>
            <select
              id="group"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.groupId}
              onChange={(event) => setForm({ ...form, groupId: event.target.value })}
            >
              <option value="">Route automatically</option>
              {(reference.data?.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value, subcategory: "" })
              }
            >
              <option value="">Not classified</option>
              {INCIDENT_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subcategory">Subcategory</Label>
            <select
              id="subcategory"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.subcategory}
              onChange={(event) => setForm({ ...form, subcategory: event.target.value })}
              disabled={subcategories.length === 0}
            >
              <option value="">{subcategories.length === 0 ? "Pick a category first" : "None"}</option>
              {subcategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactType">How it was reported</Label>
            <select
              id="contactType"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.contactType}
              onChange={(event) => setForm({ ...form, contactType: event.target.value })}
            >
              {Object.entries(CONTACT_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              Log incident
            </Button>
          </div>
        </form>
      ) : null}

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : incidents.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No incidents yet" hint="Log the first incident to start the queue." />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Short description</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {incidents.map((incident) => (
                  <tr
                    key={incident.id}
                    className={
                      incident.id === search.record ? "bg-accent/40" : "hover:bg-muted/60"
                    }
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary underline underline-offset-4"
                        onClick={() =>
                          void navigate({ to: "/incidents", search: { record: incident.id } })
                        }
                      >
                        {incident.number}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{incident.title}</td>
                    <td className="px-4 py-2.5">
                      <PriorityBadge priority={incident.priority} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StateBadge state={incident.state} />
                    </td>
                    <td className="px-4 py-2.5">
                      <SlaBadge dueAt={incident.sla_due_at} resolvedAt={incident.resolved_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="rounded-lg border border-border bg-card p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select an incident number to open its record, timeline, and actions.
              </p>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{selected.number}</p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <PriorityBadge priority={selected.priority} />
                    <StateBadge state={selected.state} />
                    <SlaBadge dueAt={selected.sla_due_at} resolvedAt={selected.resolved_at} />
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Logged</dt>
                    <dd className="mt-0.5 text-foreground">{formatDateTime(selected.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">SLA due</dt>
                    <dd className="mt-0.5 text-foreground">{formatDateTime(selected.sla_due_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Category</dt>
                    <dd className="mt-0.5 text-foreground">
                      {categoryLabel(selected.category)}
                      {selected.subcategory ? ` · ${selected.subcategory}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reported via</dt>
                    <dd className="mt-0.5 text-foreground">
                      {labelOf(CONTACT_TYPES, selected.contact_type)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">First response</dt>
                    <dd className="mt-0.5 text-foreground">
                      {formatDateTime(selected.first_responded_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reopened</dt>
                    <dd className="mt-0.5 text-foreground">{selected.reopen_count ?? 0}×</dd>
                  </div>
                  {selected.state === "pending" ? (
                    <div>
                      <dt className="text-muted-foreground">On hold reason</dt>
                      <dd className="mt-0.5 text-foreground">
                        {labelOf(HOLD_REASONS, selected.on_hold_reason)}
                      </dd>
                    </div>
                  ) : null}
                  {selected.close_code ? (
                    <div>
                      <dt className="text-muted-foreground">Close code</dt>
                      <dd className="mt-0.5 text-foreground">
                        {labelOf(CLOSE_CODES, selected.close_code)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Description</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-foreground">
                      {selected.description}
                    </dd>
                  </div>
                  {selected.resolution_notes ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Resolution</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-foreground">
                        {selected.resolution_notes}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {manager ? (
                  <div className="space-y-3 rounded-md border border-border bg-background p-3">
                    <h3 className="text-sm font-semibold text-foreground">Actions</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => update.mutate({ id: selected.id, assignToMe: true })}
                        disabled={update.isPending}
                      >
                        Assign to me
                      </Button>
                      {(["open", "in_progress", "pending"] as RecordState[]).map((state) => (
                        <Button
                          key={state}
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            update.mutate({
                              id: selected.id,
                              state,
                              ...(state === "pending" ? { onHoldReason: holdReason } : {}),
                            })
                          }
                          disabled={update.isPending}
                        >
                          {STATE_LABELS[state]}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="holdReason">On hold reason (applied when set to pending)</Label>
                      <select
                        id="holdReason"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={holdReason}
                        onChange={(event) => setHoldReason(event.target.value)}
                      >
                        {Object.entries(HOLD_REASONS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="resolution">Resolution notes</Label>
                      <Textarea
                        id="resolution"
                        rows={3}
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        placeholder="Required before resolving or closing"
                      />
                      <div className="space-y-1.5">
                        <Label htmlFor="closeCode">Close code</Label>
                        <select
                          id="closeCode"
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={closeCode}
                          onChange={(event) => setCloseCode(event.target.value)}
                        >
                          {Object.entries(CLOSE_CODES).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        {(["resolved", "closed"] as RecordState[]).map((state) => (
                          <Button
                            key={state}
                            size="sm"
                            onClick={() =>
                              update.mutate({
                                id: selected.id,
                                state,
                                closeCode,
                                resolutionNotes: resolution || selected.resolution_notes || "",
                              })
                            }
                            disabled={
                              update.isPending ||
                              (resolution.trim().length === 0 && !selected.resolution_notes)
                            }
                          >
                            Mark {STATE_LABELS[state].toLowerCase()}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                    You can follow this incident and add updates. State changes are handled by the
                    service desk.
                  </p>
                )}

                <RecordActivity
                  recordType="incident"
                  recordId={selected.id}
                  canPostInternal={manager}
                />
              </div>
            )}
          </aside>
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        States available: {RECORD_STATES.map((state) => STATE_LABELS[state]).join(" · ")}
      </p>
    </AppShell>
  );
}
