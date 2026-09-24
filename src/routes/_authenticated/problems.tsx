import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StateBadge, PriorityBadge } from "@/components/status-badge";
import {
  createProblem,
  linkIncidentToProblem,
  updateProblem,
} from "@/lib/problem.functions";
import { problemBoardQuery } from "@/lib/workspace-queries";
import {
  INCIDENT_CATEGORIES,
  RECORD_STATES,
  STATE_LABELS,
  canRunProblems,
  categoryLabel,
  formatDateTime,
  type AppRole,
  type RecordState,
} from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const problemSearchSchema = z.object({
  record: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/problems")({
  validateSearch: zodValidator(problemSearchSchema),
  head: () => ({
    meta: [
      { title: "Problem management — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Investigate recurring incidents as problems, record root cause and workarounds, and publish known errors.",
      },
      { property: "og:title", content: "Problem management — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Root cause investigations fed by linked incidents, workarounds, and known errors.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Problems,
});

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function Problems() {
  const workspace = useWorkspace();
  const board = useQuery(problemBoardQuery());
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    impact: 2,
    urgency: 2,
    category: "",
    serviceId: "",
    fromIncidentId: "",
  });
  const [investigation, setInvestigation] = useState({
    workaround: "",
    rootCause: "",
    fixPlan: "",
    resolutionNotes: "",
  });
  const [filter, setFilter] = useState<"open" | "all">("open");

  const roles = (workspace.data?.roles ?? []) as AppRole[];
  const canRun = canRunProblems(roles);

  const problems = board.data?.problems ?? [];
  const links = board.data?.links ?? [];
  const incidents = board.data?.incidents ?? [];
  const services = board.data?.services ?? [];
  const profiles = board.data?.profiles ?? [];

  const nameOf = (id: string | null) =>
    profiles.find((person) => person.id === id)?.display_name ?? "Unassigned";

  const linkCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of links) map.set(link.problem_id, (map.get(link.problem_id) ?? 0) + 1);
    return map;
  }, [links]);

  const visible = problems.filter((problem) =>
    filter === "all" ? true : !["resolved", "closed", "cancelled"].includes(problem.state),
  );
  const selectedId = search.record || null;
  const selected = problems.find((problem) => problem.id === selectedId) ?? null;
  const linkedIncidentIds = new Set(
    links.filter((link) => link.problem_id === selectedId).map((link) => link.incident_id),
  );
  const linkedIncidents = incidents.filter((incident) => linkedIncidentIds.has(incident.id));
  const candidates = incidents
    .filter((incident) => !linkedIncidentIds.has(incident.id))
    .filter((incident) => !["closed", "cancelled"].includes(incident.state))
    .slice(0, 40);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["problem-board"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createProblem({
        data: {
          title: draft.title,
          description: draft.description,
          impact: draft.impact,
          urgency: draft.urgency,
          category: draft.category || null,
          serviceId: draft.serviceId || null,
          fromIncidentId: draft.fromIncidentId || null,
          assignToMe: true,
        },
      }),
    onSuccess: async (problem) => {
      toast.success(`${problem.number} opened for investigation.`);
      setCreating(false);
      setDraft({
        title: "",
        description: "",
        impact: 2,
        urgency: 2,
        category: "",
        serviceId: "",
        fromIncidentId: "",
      });
      void navigate({ search: { record: problem.id } });
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The problem was not created."),
  });

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof updateProblem>[0]["data"]) =>
      updateProblem({ data: payload }),
    onSuccess: async () => {
      toast.success("Problem updated.");
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The update was not saved."),
  });

  const link = useMutation({
    mutationFn: (payload: { incidentId: string; linked: boolean }) =>
      linkIncidentToProblem({
        data: { problemId: selectedId ?? "", incidentId: payload.incidentId, linked: payload.linked },
      }),
    onSuccess: async () => refresh(),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The incident link did not change."),
  });

  function startInvestigation(problemId: string) {
    const problem = problems.find((item) => item.id === problemId);
    void navigate({ search: { record: problemId } });
    setInvestigation({
      workaround: problem?.workaround ?? "",
      rootCause: problem?.root_cause ?? "",
      fixPlan: problem?.fix_plan ?? "",
      resolutionNotes: problem?.resolution_notes ?? "",
    });
  }

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        eyebrow="Problem management"
        title="Problems & known errors"
        description="Group repeat incidents into a single investigation, publish a workaround while you work, and close only with a recorded root cause."
        actions={
          <div className="flex items-center gap-2">
            <select
              className={selectClass}
              value={filter}
              onChange={(event) => setFilter(event.target.value as "open" | "all")}
              aria-label="Filter problems"
            >
              <option value="open">Active only</option>
              <option value="all">All problems</option>
            </select>
            {canRun ? (
              <Button size="sm" onClick={() => setCreating((value) => !value)}>
                {creating ? "Cancel" : "New problem"}
              </Button>
            ) : null}
          </div>
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
            <Label htmlFor="prb-title">Problem statement</Label>
            <Input
              id="prb-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prb-description">What is happening and how often?</Label>
            <Textarea
              id="prb-description"
              rows={4}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prb-impact">Impact</Label>
            <select
              id="prb-impact"
              className={selectClass}
              value={draft.impact}
              onChange={(event) => setDraft({ ...draft, impact: Number(event.target.value) })}
            >
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prb-urgency">Urgency</Label>
            <select
              id="prb-urgency"
              className={selectClass}
              value={draft.urgency}
              onChange={(event) => setDraft({ ...draft, urgency: Number(event.target.value) })}
            >
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prb-category">Category</Label>
            <select
              id="prb-category"
              className={selectClass}
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            >
              <option value="">Not set</option>
              {INCIDENT_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prb-service">Affected service</Label>
            <select
              id="prb-service"
              className={selectClass}
              value={draft.serviceId}
              onChange={(event) => setDraft({ ...draft, serviceId: event.target.value })}
            >
              <option value="">Not set</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prb-incident">Link a triggering incident (optional)</Label>
            <select
              id="prb-incident"
              className={selectClass}
              value={draft.fromIncidentId}
              onChange={(event) => setDraft({ ...draft, fromIncidentId: event.target.value })}
            >
              <option value="">No incident yet</option>
              {incidents.slice(0, 40).map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.number} — {incident.title}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              Open problem
            </Button>
          </div>
        </form>
      ) : null}

      {board.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No problems under investigation"
            hint="Open a problem from a repeat incident to start root cause analysis."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.25fr]">
          <ul className="space-y-2">
            {visible.map((problem) => (
              <li key={problem.id}>
                <button
                  type="button"
                  onClick={() => startInvestigation(problem.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    problem.id === selectedId
                      ? "border-primary/50 bg-accent/40"
                      : "border-border bg-card hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{problem.number}</span>
                    <span>{linkCount.get(problem.id) ?? 0} linked incidents</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{problem.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StateBadge state={problem.state as RecordState} />
                    <PriorityBadge priority={problem.priority} />
                    {problem.known_error ? (
                      <span className="inline-flex items-center rounded-md border border-warning/50 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                        Known error
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {categoryLabel(problem.category)} · {nameOf(problem.assignee_id)} · updated{" "}
                    {formatDateTime(problem.updated_at)}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <section className="rounded-lg border border-border bg-card p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a problem to review its investigation and linked incidents.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs text-muted-foreground">{selected.number}</p>
                  <div className="flex items-center gap-2">
                    <StateBadge state={selected.state as RecordState} />
                    <PriorityBadge priority={selected.priority} />
                  </div>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {selected.description}
                </p>

                {canRun ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <select
                      className={`${selectClass} w-auto`}
                      value={selected.state}
                      onChange={(event) =>
                        save.mutate({
                          id: selected.id,
                          state: event.target.value,
                          rootCause: investigation.rootCause || null,
                          resolutionNotes: investigation.resolutionNotes || null,
                        })
                      }
                      aria-label="Problem state"
                    >
                      {RECORD_STATES.map((state) => (
                        <option key={state} value={state}>
                          {STATE_LABELS[state]}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => save.mutate({ id: selected.id, assignToMe: true })}
                    >
                      Assign to me
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        save.mutate({ id: selected.id, knownError: !selected.known_error })
                      }
                    >
                      {selected.known_error ? "Clear known error" : "Mark known error"}
                    </Button>
                  </div>
                ) : null}

                <div className="mt-5 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="prb-workaround">Workaround shared with the service desk</Label>
                    <Textarea
                      id="prb-workaround"
                      rows={3}
                      value={investigation.workaround}
                      readOnly={!canRun}
                      onChange={(event) =>
                        setInvestigation({ ...investigation, workaround: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prb-root">Root cause</Label>
                    <Textarea
                      id="prb-root"
                      rows={3}
                      value={investigation.rootCause}
                      readOnly={!canRun}
                      onChange={(event) =>
                        setInvestigation({ ...investigation, rootCause: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prb-fix">Permanent fix plan</Label>
                    <Textarea
                      id="prb-fix"
                      rows={3}
                      value={investigation.fixPlan}
                      readOnly={!canRun}
                      onChange={(event) =>
                        setInvestigation({ ...investigation, fixPlan: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prb-notes">Resolution notes</Label>
                    <Textarea
                      id="prb-notes"
                      rows={3}
                      value={investigation.resolutionNotes}
                      readOnly={!canRun}
                      onChange={(event) =>
                        setInvestigation({ ...investigation, resolutionNotes: event.target.value })
                      }
                    />
                  </div>
                  {canRun ? (
                    <Button
                      size="sm"
                      disabled={save.isPending}
                      onClick={() =>
                        save.mutate({
                          id: selected.id,
                          workaround: investigation.workaround || null,
                          rootCause: investigation.rootCause || null,
                          fixPlan: investigation.fixPlan || null,
                          resolutionNotes: investigation.resolutionNotes || null,
                        })
                      }
                    >
                      Save investigation
                    </Button>
                  ) : null}
                </div>

                <div className="mt-6 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    Linked incidents ({linkedIncidents.length})
                  </h3>
                  {linkedIncidents.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      No incidents linked yet. Link the tickets this problem explains.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {linkedIncidents.map((incident) => (
                        <li
                          key={incident.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="font-mono text-xs text-muted-foreground">
                              {incident.number}
                            </span>{" "}
                            <span className="truncate">{incident.title}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <StateBadge state={incident.state as RecordState} />
                            {canRun ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  link.mutate({ incidentId: incident.id, linked: false })
                                }
                              >
                                Unlink
                              </Button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canRun ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        className={`${selectClass} w-auto max-w-full`}
                        defaultValue=""
                        aria-label="Link an incident"
                        onChange={(event) => {
                          if (!event.target.value) return;
                          link.mutate({ incidentId: event.target.value, linked: true });
                          event.target.value = "";
                        }}
                      >
                        <option value="">Link an incident…</option>
                        {candidates.map((incident) => (
                          <option key={incident.id} value={incident.id}>
                            {incident.number} — {incident.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
