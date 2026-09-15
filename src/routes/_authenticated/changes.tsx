import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { STATE_LABELS, formatDateTime, type AppRole, type RecordState } from "@/lib/itsm-shared";
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
        content: "Raise standard, normal, and emergency changes with risk, CAB approval, windows, and rollback plans.",
      },
      { property: "og:title", content: "Change enablement — WeCrew ITSM" },
      { property: "og:description", content: "Change records with CAB approval and post-implementation review." },
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
  implementationPlan: "",
  testPlan: "",
  rollbackPlan: "",
  startAt: "",
  endAt: "",
};

function Changes() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [form, setForm] = useState(emptyForm);
  const [raising, setRaising] = useState(false);
  const [pir, setPir] = useState("");

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const canRaise = roles.some((role) =>
    ["fulfiller", "change_manager", "manager", "admin"].includes(role),
  );
  const isChangeManager = roles.some((role) => ["change_manager", "admin"].includes(role));
  const changes = data?.changes ?? [];
  const selected = changes.find((item) => item.id === search.record) ?? null;

  const create = useMutation({
    mutationFn: () =>
      createChange({
        data: {
          title: form.title,
          description: form.description,
          changeType: form.changeType,
          risk: form.risk,
          serviceId: form.serviceId || null,
          implementationPlan: form.implementationPlan,
          testPlan: form.testPlan,
          rollbackPlan: form.rollbackPlan,
          startAt: form.startAt,
          endAt: form.endAt,
        },
      }),
    onSuccess: async (change) => {
      toast.success(`Change ${change.number} raised and sent to CAB.`);
      setForm(emptyForm);
      setRaising(false);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/changes", search: { record: change.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The change was not raised."),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; state?: RecordState; pirNotes?: string }) =>
      updateChange({ data: input }),
    onSuccess: async () => {
      toast.success("Change updated.");
      setPir("");
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
            <Label htmlFor="chg-end">Window end</Label>
            <Input
              id="chg-end"
              type="datetime-local"
              value={form.endAt}
              onChange={(event) => setForm({ ...form, endAt: event.target.value })}
              required
            />
          </div>
          {(
            [
              ["implementationPlan", "Implementation plan"],
              ["testPlan", "Test plan"],
              ["rollbackPlan", "Rollback plan"],
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
          <EmptyState title="No changes recorded" hint="Raise a change to start the CAB workflow." />
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
                        onClick={() => void navigate({ to: "/changes", search: { record: change.id } })}
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
                  </div>
                </div>

                <dl className="space-y-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Window</dt>
                    <dd className="mt-0.5 text-foreground">
                      {formatDateTime(selected.start_at)} → {formatDateTime(selected.end_at)}
                    </dd>
                  </div>
                  {(
                    [
                      ["Reason", selected.description],
                      ["Implementation plan", selected.implementation_plan],
                      ["Test plan", selected.test_plan],
                      ["Rollback plan", selected.rollback_plan],
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

                {isChangeManager ? (
                  <div className="space-y-3 rounded-md border border-border bg-background p-3">
                    <h3 className="text-sm font-semibold text-foreground">Change manager actions</h3>
                    <div className="flex flex-wrap gap-2">
                      {(["in_progress", "resolved", "closed", "cancelled"] as RecordState[]).map(
                        (state) => (
                          <Button
                            key={state}
                            size="sm"
                            variant="outline"
                            onClick={() => update.mutate({ id: selected.id, state })}
                            disabled={update.isPending}
                          >
                            {STATE_LABELS[state]}
                          </Button>
                        ),
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pir">Post-implementation review</Label>
                      <Textarea
                        id="pir"
                        rows={3}
                        value={pir}
                        onChange={(event) => setPir(event.target.value)}
                        placeholder="Outcome, deviations, follow-up actions"
                      />
                      <Button
                        size="sm"
                        onClick={() => update.mutate({ id: selected.id, pirNotes: pir })}
                        disabled={update.isPending || pir.trim().length === 0}
                      >
                        Save review
                      </Button>
                    </div>
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
