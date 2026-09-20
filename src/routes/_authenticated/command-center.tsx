import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StateBadge } from "@/components/status-badge";
import {
  declareMajorIncident,
  postMajorIncidentUpdate,
  updateMajorIncident,
} from "@/lib/problem.functions";
import { commandCenterQuery } from "@/lib/workspace-queries";
import {
  AUDIENCE_LABELS,
  BRIDGE_STATES,
  BRIDGE_STATE_LABELS,
  SEVERITY_LABELS,
  UPDATE_TYPE_LABELS,
  canRunProblems,
  formatDateTime,
  relativeTime,
  type AppRole,
  type RecordState,
} from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/command-center")({
  head: () => ({
    meta: [
      { title: "Major incident command — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Declare major incidents, run the command bridge, post stakeholder updates, escalate, and hand off to a problem investigation.",
      },
      { property: "og:title", content: "Major incident command — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Command bridge for severity 1 events with a timeline, escalation, and comms log.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommandCenter,
});

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function CommandCenter() {
  const workspace = useWorkspace();
  const center = useQuery(commandCenterQuery());
  const queryClient = useQueryClient();

  const [declaring, setDeclaring] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    incidentId: "",
    severity: 1,
    situationSummary: "",
    customerImpact: "",
    bridgeUrl: "",
    nextUpdateMinutes: 30,
  });
  const [note, setNote] = useState({
    body: "",
    updateType: "status",
    audience: "internal",
    nextUpdateMinutes: 30,
  });

  const roles = (workspace.data?.roles ?? []) as AppRole[];
  const canRun = canRunProblems(roles);

  const majors = center.data?.majors ?? [];
  const updates = center.data?.updates ?? [];
  const incidents = center.data?.incidents ?? [];
  const problems = center.data?.problems ?? [];
  const profiles = center.data?.profiles ?? [];

  const nameOf = (id: string | null) =>
    profiles.find((person) => person.id === id)?.display_name ?? "Unassigned";
  const incidentOf = (id: string) => incidents.find((incident) => incident.id === id);

  const active = majors.filter((major) => major.bridge_state !== "resolved");
  const selected =
    majors.find((major) => major.id === selectedId) ?? active[0] ?? majors[0] ?? null;
  const timeline = updates.filter((update) => update.major_incident_id === selected?.id);
  const candidates = incidents
    .filter((incident) => !majors.some((major) => major.incident_id === incident.id))
    .filter((incident) => !["closed", "cancelled", "resolved"].includes(incident.state))
    .slice(0, 40);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["command-center"] });
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
  };

  const declare = useMutation({
    mutationFn: () =>
      declareMajorIncident({
        data: {
          incidentId: draft.incidentId,
          severity: draft.severity,
          situationSummary: draft.situationSummary,
          customerImpact: draft.customerImpact || null,
          bridgeUrl: draft.bridgeUrl || null,
          takeCommand: true,
          nextUpdateMinutes: draft.nextUpdateMinutes,
        },
      }),
    onSuccess: async (major) => {
      toast.success(`${major.number} declared. You are the incident commander.`);
      setDeclaring(false);
      setSelectedId(major.id);
      setDraft({
        incidentId: "",
        severity: 1,
        situationSummary: "",
        customerImpact: "",
        bridgeUrl: "",
        nextUpdateMinutes: 30,
      });
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The major incident was not declared."),
  });

  const patch = useMutation({
    mutationFn: (payload: Parameters<typeof updateMajorIncident>[0]["data"]) =>
      updateMajorIncident({ data: payload }),
    onSuccess: async () => {
      toast.success("Command record updated.");
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The update was not saved."),
  });

  const post = useMutation({
    mutationFn: () =>
      postMajorIncidentUpdate({
        data: {
          majorIncidentId: selected?.id ?? "",
          body: note.body,
          updateType: note.updateType as "status",
          audience: note.audience as "internal",
          nextUpdateMinutes: note.nextUpdateMinutes,
        },
      }),
    onSuccess: async () => {
      toast.success("Update posted to the bridge log.");
      setNote({ ...note, body: "" });
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The update was not posted."),
  });

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        eyebrow="Major incident command"
        title="Command bridge"
        description="Declare a major incident from a live ticket, run the bridge with a single commander, keep stakeholders updated on cadence, and hand the cause to problem management."
        actions={
          canRun ? (
            <Button size="sm" onClick={() => setDeclaring((value) => !value)}>
              {declaring ? "Cancel" : "Declare major incident"}
            </Button>
          ) : null
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Active bridges" value={active.length} />
        <Kpi
          label="Severity 1 active"
          value={active.filter((major) => major.severity === 1).length}
          tone={active.some((major) => major.severity === 1) ? "alert" : "normal"}
        />
        <Kpi
          label="Updates overdue"
          value={
            active.filter(
              (major) => major.next_update_at && new Date(major.next_update_at) < new Date(),
            ).length
          }
          tone={
            active.some(
              (major) => major.next_update_at && new Date(major.next_update_at) < new Date(),
            )
              ? "alert"
              : "normal"
          }
        />
      </div>

      {declaring ? (
        <form
          className="mt-6 grid gap-4 rounded-lg border border-destructive/40 bg-card p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            declare.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mi-incident">Incident to escalate</Label>
            <select
              id="mi-incident"
              className={selectClass}
              value={draft.incidentId}
              onChange={(event) => setDraft({ ...draft, incidentId: event.target.value })}
              required
            >
              <option value="">Choose an active incident…</option>
              {candidates.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.number} — {incident.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mi-severity">Severity</Label>
            <select
              id="mi-severity"
              className={selectClass}
              value={draft.severity}
              onChange={(event) => setDraft({ ...draft, severity: Number(event.target.value) })}
            >
              {[1, 2, 3].map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mi-cadence">Update cadence (minutes)</Label>
            <Input
              id="mi-cadence"
              type="number"
              min={5}
              max={480}
              value={draft.nextUpdateMinutes}
              onChange={(event) =>
                setDraft({ ...draft, nextUpdateMinutes: Number(event.target.value) })
              }
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mi-summary">Situation summary</Label>
            <Textarea
              id="mi-summary"
              rows={3}
              value={draft.situationSummary}
              onChange={(event) => setDraft({ ...draft, situationSummary: event.target.value })}
              minLength={10}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mi-impact">Customer impact</Label>
            <Textarea
              id="mi-impact"
              rows={2}
              value={draft.customerImpact}
              onChange={(event) => setDraft({ ...draft, customerImpact: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mi-bridge">Bridge link or dial-in</Label>
            <Input
              id="mi-bridge"
              value={draft.bridgeUrl}
              onChange={(event) => setDraft({ ...draft, bridgeUrl: event.target.value })}
              placeholder="https://meet.example.com/major-incident"
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="destructive" disabled={declare.isPending}>
              Declare and take command
            </Button>
          </div>
        </form>
      ) : null}

      {center.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : majors.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No major incidents declared"
            hint="Declare one from a live ticket when impact is widespread and needs a command bridge."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.35fr]">
          <ul className="space-y-2">
            {majors.map((major) => {
              const incident = incidentOf(major.incident_id);
              const overdue = major.next_update_at && new Date(major.next_update_at) < new Date();
              return (
                <li key={major.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(major.id)}
                    className={cn(
                      "w-full rounded-lg border p-4 text-left transition-colors",
                      major.id === selected?.id
                        ? "border-primary/50 bg-accent/40"
                        : "border-border bg-card hover:bg-muted/60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{major.number}</span>
                      <span>{relativeTime(major.declared_at)}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {incident?.title ?? "Incident"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                        Sev {major.severity}
                      </span>
                      <span className="inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                        {BRIDGE_STATE_LABELS[major.bridge_state as keyof typeof BRIDGE_STATE_LABELS] ??
                          major.bridge_state}
                      </span>
                      {overdue && major.bridge_state !== "resolved" ? (
                        <span className="inline-flex items-center rounded-md border border-warning/50 bg-warning/15 px-2 py-0.5 font-medium text-warning-foreground">
                          Update due
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Commander {nameOf(major.commander_id)} · escalation L{major.escalation_level}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          <section className="space-y-5">
            {!selected ? null : (
              <>
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {selected.number} · {incidentOf(selected.incident_id)?.number ?? "—"}
                    </p>
                    {incidentOf(selected.incident_id) ? (
                      <StateBadge
                        state={incidentOf(selected.incident_id)!.state as RecordState}
                      />
                    ) : null}
                  </div>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">
                    {incidentOf(selected.incident_id)?.title ?? "Major incident"}
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {selected.situation_summary ?? "No situation summary recorded yet."}
                  </p>

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <Field label="Commander" value={nameOf(selected.commander_id)} />
                    <Field label="Communications lead" value={nameOf(selected.comms_lead_id)} />
                    <Field label="Declared" value={formatDateTime(selected.declared_at)} />
                    <Field
                      label="Next update due"
                      value={
                        selected.next_update_at
                          ? `${formatDateTime(selected.next_update_at)} (${relativeTime(selected.next_update_at)})`
                          : "—"
                      }
                    />
                    <Field
                      label="Customer impact"
                      value={selected.customer_impact ?? "Not recorded"}
                    />
                    <Field
                      label="Bridge"
                      value={selected.bridge_url ?? "No bridge link"}
                    />
                  </dl>

                  {canRun ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <select
                        className={`${selectClass} w-auto`}
                        value={selected.bridge_state}
                        aria-label="Bridge state"
                        onChange={(event) =>
                          patch.mutate({ id: selected.id, bridgeState: event.target.value })
                        }
                      >
                        {BRIDGE_STATES.map((state) => (
                          <option key={state} value={state}>
                            {BRIDGE_STATE_LABELS[state]}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => patch.mutate({ id: selected.id, takeCommand: true })}
                      >
                        Take command
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => patch.mutate({ id: selected.id, takeComms: true })}
                      >
                        Take comms
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          patch.mutate({
                            id: selected.id,
                            escalationLevel: Math.min(4, (selected.escalation_level ?? 1) + 1),
                          })
                        }
                      >
                        Escalate to L{Math.min(4, (selected.escalation_level ?? 1) + 1)}
                      </Button>
                      <select
                        className={`${selectClass} w-auto`}
                        value={selected.problem_id ?? ""}
                        aria-label="Link a problem"
                        onChange={(event) =>
                          patch.mutate({ id: selected.id, problemId: event.target.value || null })
                        }
                      >
                        <option value="">No problem linked</option>
                        {problems.map((problem) => (
                          <option key={problem.id} value={problem.id}>
                            {problem.number} — {problem.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                {canRun ? (
                  <form
                    className="rounded-lg border border-border bg-card p-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      post.mutate();
                    }}
                  >
                    <h3 className="text-sm font-semibold text-foreground">Post a bridge update</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="mi-type">Type</Label>
                        <select
                          id="mi-type"
                          className={selectClass}
                          value={note.updateType}
                          onChange={(event) => setNote({ ...note, updateType: event.target.value })}
                        >
                          {["status", "action", "escalation", "comms", "resolution"].map((type) => (
                            <option key={type} value={type}>
                              {UPDATE_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mi-audience">Audience</Label>
                        <select
                          id="mi-audience"
                          className={selectClass}
                          value={note.audience}
                          onChange={(event) => setNote({ ...note, audience: event.target.value })}
                        >
                          {["internal", "customer", "executive"].map((audience) => (
                            <option key={audience} value={audience}>
                              {AUDIENCE_LABELS[audience]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mi-next">Next update in (minutes)</Label>
                        <Input
                          id="mi-next"
                          type="number"
                          min={5}
                          max={480}
                          value={note.nextUpdateMinutes}
                          onChange={(event) =>
                            setNote({ ...note, nextUpdateMinutes: Number(event.target.value) })
                          }
                        />
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor="mi-body">Update</Label>
                      <Textarea
                        id="mi-body"
                        rows={3}
                        value={note.body}
                        onChange={(event) => setNote({ ...note, body: event.target.value })}
                        minLength={3}
                        required
                      />
                    </div>
                    <Button className="mt-3" size="sm" type="submit" disabled={post.isPending}>
                      Post update
                    </Button>
                  </form>
                ) : null}

                <div className="rounded-lg border border-border bg-card p-5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Bridge timeline ({timeline.length})
                  </h3>
                  {timeline.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">No updates posted yet.</p>
                  ) : (
                    <ol className="mt-3 space-y-3 border-l border-border pl-4">
                      {timeline.map((update) => (
                        <li key={update.id} className="relative">
                          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {UPDATE_TYPE_LABELS[update.update_type] ?? update.update_type}
                            </span>
                            <span>{AUDIENCE_LABELS[update.audience] ?? update.audience}</span>
                            <span>{formatDateTime(update.created_at)}</span>
                            <span>{nameOf(update.author_id)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                            {update.body}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "alert";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-4 py-3",
        tone === "alert" ? "border-destructive/40" : "border-border",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          tone === "alert" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}
