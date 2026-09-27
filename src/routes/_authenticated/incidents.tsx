import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, SlaBadge, StateBadge } from "@/components/status-badge";
import { RecordActivity } from "@/components/record-activity";
import { createIncident, updateIncident } from "@/lib/itsm.functions";
import { IncidentWorkbench } from "@/components/incident-workbench";
import {
  getIncidentQueue,
  getIncidentQueueCounts,
  getIncidentRecord,
} from "@/lib/incident-queue.functions";
import {
  INCIDENT_PAGE_SIZE,
  incidentQueueSchema,
  incidentSearchSchema,
  type IncidentQueueFilters,
} from "@/lib/incident-queue";
import {
  allowedIncidentTransitions,
  canManageIncidents,
  type IncidentWorkflowInput,
} from "@/lib/incident-workflow";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { referenceQuery } from "@/lib/workspace-queries";
import {
  CLOSE_CODES,
  CONTACT_TYPES,
  HOLD_REASONS,
  IMPACT_URGENCY_LABELS,
  INCIDENT_CATEGORIES,
  STATE_LABELS,
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
  validateSearch: incidentSearchSchema,
  head: () => ({
    meta: [
      { title: "Incidents — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Log, triage, assign, and resolve incidents with impact and urgency driven priority.",
      },
      { property: "og:title", content: "Incidents — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Incident queue with SLA timers and resolution evidence.",
      },
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
  const manager = canManageIncidents(roles);
  const filters = incidentQueueSchema.parse(search);
  const queue = useQuery({
    queryKey: ["incident-queue", filters],
    queryFn: () => getIncidentQueue({ data: filters }),
    enabled: !!data,
    refetchInterval: 30_000,
  });
  const counts = useQuery({
    queryKey: ["incident-queue-counts"],
    queryFn: () => getIncidentQueueCounts(),
    enabled: !!data,
    refetchInterval: 30_000,
  });
  const record = useQuery({
    queryKey: ["incident-record", search.record],
    queryFn: () => getIncidentRecord({ data: { id: search.record! } }),
    enabled: !!data && !!search.record,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const selected = record.data ?? null;
  const transitions = selected ? allowedIncidentTransitions(selected.state) : [];
  useEffect(() => {
    setResolution("");
    setCloseCode("solved_permanently");
    setHoldReason("awaiting_caller");
  }, [search.record]);
  const setFilters = (patch: Partial<IncidentQueueFilters>) => {
    void navigate({ to: "/incidents", search: { ...search, ...patch } });
  };
  const selectIncident = (id: string) =>
    void navigate({ to: "/incidents", search: { ...search, record: id } });

  const refresh = async () => {
    await Promise.all(
      [
        "workspace",
        "incident-metrics",
        "incident-queue",
        "incident-queue-counts",
        "incident-record",
        "activity",
        "command-center",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
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
      selectIncident(incident.id);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The incident was not logged."),
  });

  const update = useMutation({
    mutationFn: (input: Omit<IncidentWorkflowInput, "expectedUpdatedAt">) => {
      if (!selected || input.id !== selected.id)
        throw new Error("Select an incident before updating it.");
      return updateIncident({ data: { ...input, expectedUpdatedAt: selected.updated_at } });
    },
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
        title="Incident workspace"
        description="Triage incoming work, protect service targets, and keep every resolution accountable."
        actions={
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? (
              "Cancel"
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Log incident
              </>
            )}
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
              <option value="">Leave unassigned</option>
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
              <option value="">
                {subcategories.length === 0 ? "Pick a category first" : "None"}
              </option>
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

      {workspace.isError ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-5"
        >
          <h2 className="font-semibold">Workspace unavailable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.error instanceof Error
              ? workspace.error.message
              : "Please retry loading your workspace."}
          </p>
          <Button className="mt-3" variant="outline" onClick={() => void workspace.refetch()}>
            Try again
          </Button>
        </div>
      ) : workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : (
        <>
          {reference.isError ? (
            <p role="status" className="mt-4 text-sm text-destructive">
              Service and assignment details are unavailable.{" "}
              <button className="underline" onClick={() => void reference.refetch()}>
                Retry
              </button>
            </p>
          ) : null}
          <IncidentWorkbench
            incidents={queue.data?.incidents ?? []}
            total={queue.data?.total}
            pageSize={INCIDENT_PAGE_SIZE}
            counts={counts.data}
            countsError={counts.isError}
            filters={filters}
            onFilters={setFilters}
            onSelect={selectIncident}
            onRefresh={() => void refresh()}
            loading={queue.isPending}
            refreshing={queue.isFetching || counts.isFetching}
            error={queue.isError ? queue.error.message : null}
            updatedAt={queue.dataUpdatedAt}
            selectedId={search.record}
            groups={reference.data?.groups ?? []}
            services={reference.data?.services ?? []}
            people={reference.data?.people ?? []}
          />
        </>
      )}
      <Sheet
        open={!!search.record}
        onOpenChange={(open) => {
          if (!open) {
            const { record: _record, ...remaining } = search;
            void navigate({ to: "/incidents", search: remaining });
          }
        }}
      >
        <SheetContent
          className="w-full overflow-y-auto bg-card sm:max-w-[600px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLElement>('[aria-label="Search incident number or title"]')
              ?.focus();
          }}
        >
          <SheetTitle className="pr-6">{selected?.number ?? "Incident details"}</SheetTitle>
          <SheetDescription className="mt-1 mb-6">
            Ownership, service context, and resolution history.
          </SheetDescription>
          {record.isError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 p-4">
              <p className="text-sm">{record.error.message}</p>
              <Button className="mt-3" variant="outline" onClick={() => void record.refetch()}>
                Retry record
              </Button>
            </div>
          ) : record.isPending ? (
            <WorkspaceLoading />
          ) : !selected ? (
            <p className="text-sm text-muted-foreground">
              This incident does not exist or you do not have access to it.
            </p>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <PriorityBadge priority={selected.priority} />
                  <StateBadge state={selected.state} />
                  <SlaBadge
                    dueAt={selected.sla_due_at}
                    resolvedAt={selected.resolved_at}
                    recordState={selected.state}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span>Updated {formatDateTime(selected.updated_at)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={record.isFetching || update.isPending}
                  onClick={() => void record.refetch()}
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh record
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-border p-4 text-xs">
                <div>
                  <dt className="text-muted-foreground">Assigned to</dt>
                  <dd className="mt-1 font-medium">
                    {reference.data?.people.find((p) => p.id === selected.assignee_id)
                      ?.display_name ??
                      (selected.assignee_id ? "Assigned colleague" : "Unassigned")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Affected service</dt>
                  <dd className="mt-1 font-medium">
                    {reference.data?.services.find((s) => s.id === selected.service_id)?.name ??
                      "No service linked"}
                  </dd>
                </div>
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
                  <h3 className="text-sm font-semibold text-foreground">Manage incident</h3>
                  {update.isError ? (
                    <p
                      role="alert"
                      className="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                    >
                      {update.error.message}
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="incident-group">Assignment group</Label>
                    <select
                      id="incident-group"
                      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                      value={selected.group_id ?? ""}
                      disabled={update.isPending || reference.isError || reference.isPending}
                      onChange={(event) =>
                        update.mutate({ id: selected.id, groupId: event.target.value || null })
                      }
                    >
                      <option value="">No group</option>
                      {(reference.data?.groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => update.mutate({ id: selected.id, assignToMe: true })}
                      disabled={update.isPending || selected.assignee_id === data?.userId}
                    >
                      {selected.assignee_id === data?.userId ? "Assigned to you" : "Assign to me"}
                    </Button>
                    {transitions
                      .filter((state) => ["open", "in_progress", "pending"].includes(state))
                      .map((state) => (
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
                          {state === "open" && ["resolved", "closed"].includes(selected.state)
                            ? "Reopen incident"
                            : STATE_LABELS[state]}
                        </Button>
                      ))}
                  </div>
                  {transitions.includes("pending") ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="holdReason">
                        On hold reason (applied when set to pending)
                      </Label>
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
                  ) : null}
                  {transitions.some((state) => ["resolved", "closed"].includes(state)) ? (
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
                        {transitions
                          .filter((state) => ["resolved", "closed"].includes(state))
                          .map((state) => (
                            <Button
                              key={state}
                              size="sm"
                              onClick={() =>
                                update.mutate({
                                  id: selected.id,
                                  state,
                                  closeCode:
                                    state === "closed"
                                      ? (selected.close_code ?? closeCode)
                                      : closeCode,
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
                  ) : null}
                  {transitions.includes("cancelled") ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={update.isPending}
                        >
                          Cancel incident
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel {selected.number}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the incident from active queues. Cancelled incidents cannot
                            be reopened. Use resolution when service has been restored.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep incident</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => update.mutate({ id: selected.id, state: "cancelled" })}
                          >
                            Cancel incident
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
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
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
