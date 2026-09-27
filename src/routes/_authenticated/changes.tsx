import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { RiskBadge, StateBadge } from "@/components/status-badge";
import { RecordActivity } from "@/components/record-activity";
import { createChange, updateChange } from "@/lib/itsm.functions";
import { referenceQuery } from "@/lib/workspace-queries";
import { formatDateTime, type AppRole } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/changes")({
  validateSearch: z.object({ record: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Change enablement — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Raise standard, normal, and emergency changes with risk, CAB approval, windows, and rollback plans.",
      },
      { property: "og:title", content: "Change enablement — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Change records with CAB approval and post-implementation review.",
      },
    ],
  }),
  component: Changes,
});

const emptyForm = {
  title: "",
  description: "",
  changeType: "normal",
  risk: "medium",
  serviceId: "",
  ownerId: "",
  implementationPlan: "",
  testPlan: "",
  rollbackPlan: "",
  businessJustification: "",
  impactAssessment: "",
  expectedOutageMinutes: 0,
  affectedCiIds: [] as string[],
  validationPlan: "",
  rollbackTrigger: "",
  communicationPlan: "",
  startAt: "",
  endAt: "",
};

function Changes() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [form, setForm] = useState(emptyForm);
  const [raising, setRaising] = useState(false);
  const [delivery, setDelivery] = useState({
    outcome: "successful" as "successful" | "successful_with_issues" | "failed" | "rolled_back",
    validationResults: "",
    rollbackUsed: false,
    pirNotes: "",
  });

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const canRaise = roles.some((role) =>
    ["fulfiller", "change_manager", "manager", "admin"].includes(role),
  );
  const isChangeManager = roles.some((role) => ["change_manager", "admin"].includes(role));
  const changes = data?.changes ?? [];
  const selected = changes.find((item) => item.id === search.record) ?? null;
  const pendingApprovalCount = changes.filter(
    (item) => item.approval_status === "requested",
  ).length;
  const scheduledCount = changes.filter((item) => item.state === "open").length;
  const implementingCount = changes.filter((item) => item.state === "in_progress").length;
  const reviewCount = changes.filter((item) => item.state === "resolved" && !item.closed_at).length;
  const scheduleConflict =
    form.serviceId && form.startAt && form.endAt
      ? changes.find(
          (change) =>
            change.service_id === form.serviceId &&
            !["closed", "cancelled"].includes(change.state) &&
            Boolean(change.start_at && change.end_at) &&
            new Date(form.startAt) < new Date(change.end_at ?? 0) &&
            new Date(form.endAt) > new Date(change.start_at ?? 0),
        )
      : null;

  const create = useMutation({
    mutationFn: () =>
      createChange({
        data: {
          title: form.title,
          description: form.description,
          changeType: form.changeType,
          risk: form.risk,
          serviceId: form.serviceId || null,
          ownerId: form.ownerId || data?.userId || null,
          implementationPlan: form.implementationPlan,
          testPlan: form.testPlan,
          rollbackPlan: form.rollbackPlan,
          businessJustification: form.businessJustification,
          impactAssessment: form.impactAssessment,
          expectedOutageMinutes: form.expectedOutageMinutes,
          affectedCiIds: form.affectedCiIds,
          validationPlan: form.validationPlan,
          rollbackTrigger: form.rollbackTrigger,
          communicationPlan: form.communicationPlan,
          startAt: form.startAt,
          endAt: form.endAt,
        },
      }),
    onSuccess: async (change) => {
      toast.success(
        form.changeType === "standard"
          ? `Change ${change.number} scheduled on its pre-approved path.`
          : `Change ${change.number} raised and sent for approval.`,
      );
      setForm(emptyForm);
      setRaising(false);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/changes", search: { record: change.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The change was not raised."),
  });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof updateChange>[0]["data"]) =>
      updateChange({ data: input }),
    onSuccess: async () => {
      toast.success("Change updated.");
      setDelivery({
        outcome: "successful",
        validationResults: "",
        rollbackUsed: false,
        pirNotes: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That update was not applied."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Change enablement"
        title="Changes"
        description="Every change carries an implementation, test, and rollback plan before it reaches the CAB."
        actions={
          canRaise ? (
            <Button size="sm" onClick={() => setRaising((value) => !value)}>
              {raising ? "Cancel" : "Raise change"}
            </Button>
          ) : null
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Pending approval", pendingApprovalCount, "CAB decisions outstanding"],
          ["Scheduled", scheduledCount, "Approved for a change window"],
          ["Implementing", implementingCount, "Currently being delivered"],
          ["Awaiting closure", reviewCount, "Review evidence recorded"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </section>

      {raising ? (
        <form
          className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chg-title">Change title</Label>
            <Input
              id="chg-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chg-description">Reason for change</Label>
            <Textarea
              id="chg-description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chg-justification">Business justification</Label>
            <Textarea
              id="chg-justification"
              rows={2}
              value={form.businessJustification}
              onChange={(event) => setForm({ ...form, businessJustification: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chg-impact">Impact assessment</Label>
            <Textarea
              id="chg-impact"
              rows={3}
              value={form.impactAssessment}
              onChange={(event) => setForm({ ...form, impactAssessment: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-type">Change type</Label>
            <select
              id="chg-type"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.changeType}
              onChange={(event) => setForm({ ...form, changeType: event.target.value })}
            >
              <option value="standard">Standard (pre-approved pattern)</option>
              <option value="normal">Normal</option>
              <option value="emergency">Emergency</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-risk">Risk</Label>
            <select
              id="chg-risk"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.risk}
              onChange={(event) => setForm({ ...form, risk: event.target.value })}
            >
              {["low", "medium", "high", "critical"].map((risk) => (
                <option key={risk} value={risk}>
                  {risk}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-service">Affected service</Label>
            <select
              id="chg-service"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.serviceId}
              onChange={(event) => setForm({ ...form, serviceId: event.target.value })}
            >
              <option value="">None</option>
              {(reference.data?.services ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-owner">Implementation owner</Label>
            <select
              id="chg-owner"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.ownerId}
              onChange={(event) => setForm({ ...form, ownerId: event.target.value })}
            >
              <option value="">Assign to me</option>
              {(reference.data?.people ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-start">Window start</Label>
            <Input
              id="chg-start"
              type="datetime-local"
              value={form.startAt}
              onChange={(event) => setForm({ ...form, startAt: event.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-outage">Expected outage (minutes)</Label>
            <Input
              id="chg-outage"
              type="number"
              min={0}
              max={10080}
              value={form.expectedOutageMinutes}
              onChange={(event) =>
                setForm({ ...form, expectedOutageMinutes: Number(event.target.value) })
              }
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chg-assets">Affected configuration items</Label>
            <select
              id="chg-assets"
              multiple
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.affectedCiIds}
              onChange={(event) =>
                setForm({
                  ...form,
                  affectedCiIds: Array.from(event.target.selectedOptions, (option) => option.value),
                })
              }
            >
              {(reference.data?.assets ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.ci_class}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-end">Window end</Label>
            <Input
              id="chg-end"
              type="datetime-local"
              value={form.endAt}
              onChange={(event) => setForm({ ...form, endAt: event.target.value })}
              required
            />
          </div>
          {scheduleConflict ? (
            <p className="rounded-md border border-warning/50 bg-warning/15 p-3 text-sm text-warning-foreground sm:col-span-2">
              Schedule conflict: {scheduleConflict.number} overlaps this window for the same
              service.
            </p>
          ) : null}
          {(
            [
              ["implementationPlan", "Implementation plan"],
              ["testPlan", "Test plan"],
              ["rollbackPlan", "Rollback plan"],
              ["validationPlan", "Validation plan"],
              ["rollbackTrigger", "Rollback trigger"],
              ["communicationPlan", "Communication plan"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={field}>{label}</Label>
              <Textarea
                id={field}
                rows={3}
                value={form[field]}
                onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                minLength={5}
                required
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              Raise change
            </Button>
          </div>
        </form>
      ) : null}

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : changes.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No changes recorded"
            hint="Raise a change to start the CAB workflow."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">Window</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {changes.map((change) => (
                  <tr
                    key={change.id}
                    className={change.id === search.record ? "bg-accent/40" : "hover:bg-muted/60"}
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary underline underline-offset-4"
                        onClick={() =>
                          void navigate({ to: "/changes", search: { record: change.id } })
                        }
                      >
                        {change.number}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{change.title}</td>
                    <td className="px-4 py-2.5 text-xs capitalize text-muted-foreground">
                      {change.change_type}
                    </td>
                    <td className="px-4 py-2.5">
                      <StateBadge state={change.state} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(change.start_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="rounded-lg border border-border bg-card p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a change number to review its plans, window, and approvals.
              </p>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{selected.number}</p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StateBadge state={selected.state} />
                    <RiskBadge risk={selected.risk} />
                    <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium capitalize text-secondary-foreground">
                      Approval: {selected.approval_status.replaceAll("_", " ")}
                    </span>
                  </div>
                </div>

                <dl className="space-y-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Window</dt>
                    <dd className="mt-0.5 text-foreground">
                      {formatDateTime(selected.start_at)} → {formatDateTime(selected.end_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expected outage</dt>
                    <dd className="mt-0.5 text-foreground">
                      {selected.expected_outage_minutes} minutes
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Implementation owner</dt>
                    <dd className="mt-0.5 text-foreground">
                      {reference.data?.people.find((person) => person.id === selected.owner_id)
                        ?.display_name ?? "Unassigned"}
                    </dd>
                  </div>
                  {selected.actual_start_at ? (
                    <div>
                      <dt className="text-muted-foreground">Actual implementation</dt>
                      <dd className="mt-0.5 text-foreground">
                        {formatDateTime(selected.actual_start_at)} →{" "}
                        {formatDateTime(selected.actual_end_at)}
                      </dd>
                    </div>
                  ) : null}
                  {selected.rollback_used ? (
                    <div>
                      <dt className="text-muted-foreground">Rollback</dt>
                      <dd className="mt-0.5 text-foreground">
                        Rollback plan was used during delivery.
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-muted-foreground">Affected configuration items</dt>
                    <dd className="mt-0.5 text-foreground">
                      {selected.affected_ci_ids.length
                        ? selected.affected_ci_ids
                            .map(
                              (id) =>
                                reference.data?.assets.find((asset) => asset.id === id)?.name ?? id,
                            )
                            .join(", ")
                        : "None selected"}
                    </dd>
                  </div>
                  {(
                    [
                      ["Reason", selected.description],
                      ["Business justification", selected.business_justification],
                      ["Impact assessment", selected.impact_assessment],
                      ["Implementation plan", selected.implementation_plan],
                      ["Test plan", selected.test_plan],
                      ["Rollback plan", selected.rollback_plan],
                      ["Validation plan", selected.validation_plan],
                      ["Rollback trigger", selected.rollback_trigger],
                      ["Communication plan", selected.communication_plan],
                      ["Validation results", selected.validation_results],
                      ["Delivery outcome", selected.delivery_outcome?.replaceAll("_", " ")],
                      ["Post-implementation review", selected.pir_notes],
                    ] as const
                  ).map(([label, value]) =>
                    value ? (
                      <div key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{value}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>

                <div className="rounded-md border border-border bg-background p-3 text-xs">
                  <p className="font-semibold text-foreground">Approval progress</p>
                  {data?.approvals.filter(
                    (item) => item.record_type === "change" && item.record_id === selected.id,
                  ).length ? (
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {data.approvals
                        .filter(
                          (item) => item.record_type === "change" && item.record_id === selected.id,
                        )
                        .map((item) => (
                          <li key={item.id} className="flex justify-between gap-3">
                            <span className="capitalize">{item.status}</span>
                            <span>{item.decision_notes || "No decision notes"}</span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground">
                      No CAB decision required for this change.
                    </p>
                  )}
                </div>

                {isChangeManager ? (
                  <div className="space-y-3 rounded-md border border-border bg-background p-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      Change manager actions
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selected.state === "open" ? (
                        <Button
                          size="sm"
                          onClick={() => update.mutate({ id: selected.id, action: "start" })}
                          disabled={update.isPending}
                        >
                          Start implementation
                        </Button>
                      ) : null}
                      {selected.state === "resolved" ? (
                        <Button
                          size="sm"
                          onClick={() => update.mutate({ id: selected.id, action: "close" })}
                          disabled={update.isPending}
                        >
                          Close change
                        </Button>
                      ) : null}
                      {!["resolved", "closed", "cancelled"].includes(selected.state) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => update.mutate({ id: selected.id, action: "cancel" })}
                          disabled={update.isPending}
                        >
                          Cancel change
                        </Button>
                      ) : null}
                    </div>
                    {selected.state === "in_progress" ? (
                      <div className="space-y-3 border-t border-border pt-3">
                        <Label htmlFor="delivery-outcome">Delivery outcome</Label>
                        <select
                          id="delivery-outcome"
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={delivery.outcome}
                          onChange={(event) =>
                            setDelivery({
                              ...delivery,
                              outcome: event.target.value as typeof delivery.outcome,
                            })
                          }
                        >
                          <option value="successful">Successful</option>
                          <option value="successful_with_issues">Successful with issues</option>
                          <option value="failed">Failed</option>
                          <option value="rolled_back">Rolled back</option>
                        </select>
                        <Textarea
                          rows={3}
                          value={delivery.validationResults}
                          onChange={(event) =>
                            setDelivery({ ...delivery, validationResults: event.target.value })
                          }
                          placeholder="Validation results"
                        />
                        <Textarea
                          rows={3}
                          value={delivery.pirNotes}
                          onChange={(event) =>
                            setDelivery({ ...delivery, pirNotes: event.target.value })
                          }
                          placeholder="Post-implementation review"
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={delivery.rollbackUsed}
                            onChange={(event) =>
                              setDelivery({ ...delivery, rollbackUsed: event.target.checked })
                            }
                          />{" "}
                          Rollback was used
                        </label>
                        <Button
                          size="sm"
                          onClick={() =>
                            update.mutate({
                              id: selected.id,
                              action: "deliver",
                              deliveryOutcome: delivery.outcome,
                              validationResults: delivery.validationResults,
                              rollbackUsed: delivery.rollbackUsed,
                              pirNotes: delivery.pirNotes,
                            })
                          }
                          disabled={
                            update.isPending ||
                            !delivery.validationResults.trim() ||
                            !delivery.pirNotes.trim()
                          }
                        >
                          Record delivery
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <RecordActivity recordType="change" recordId={selected.id} canPostInternal />
              </div>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
