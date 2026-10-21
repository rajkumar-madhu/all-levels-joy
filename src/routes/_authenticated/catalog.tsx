import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import {
  createSelfServiceIncident,
  createServiceRequest,
  updateCatalogRouting,
} from "@/lib/itsm.functions";

const PRIORITY_LABELS: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Moderate",
  4: "Low",
};

function RoutingEditor(props: {
  itemId: string;
  groupId: string | null;
  priority: number;
  groups: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState(props.groupId ?? "");
  const [priority, setPriority] = useState(props.priority);
  const save = useMutation({
    mutationFn: () =>
      updateCatalogRouting({ data: { id: props.itemId, groupId: groupId || null, priority } }),
    onSuccess: async () => {
      toast.success("Routing rule saved.");
      await queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Routing was not saved."),
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Routing rule
      </p>
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="Default team"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="">No team</option>
          {props.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Default priority"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        >
          {[1, 2, 3, 4].map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
        Save routing
      </Button>
    </div>
  );
}
import { INCIDENT_CATEGORIES } from "@/lib/itsm-shared";
import { z } from "zod";
import { referenceQuery } from "@/lib/workspace-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/catalog")({
  validateSearch: z.object({ item: z.string().optional(), issue: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Service catalogue — Argus Service Desk" },
      {
        name: "description",
        content: "Browse available IT services and submit a request that opens a tracked ticket.",
      },
      { property: "og:title", content: "Service catalogue — Argus Service Desk" },
      {
        property: "og:description",
        content: "Pick a service, describe your need, and get a tracked request ticket instantly.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const workspace = useWorkspace();
  const canRoute = (workspace.data?.roles ?? []).some((r) => r === "admin" || r === "manager");
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const params = Route.useSearch();
  const [selectedId, setSelectedId] = useState<string | null>(params.item ?? null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const catalog = reference.data?.catalog ?? [];
  const categories = useMemo(
    () => Array.from(new Set(catalog.map((item) => item.category))).sort(),
    [catalog],
  );
  const filtered = catalog.filter((item) => {
    const q = search.trim().toLowerCase();
    const matches =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.description ?? "").toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q);
    return matches && (category === "all" || item.category === category);
  });
  const selected = catalog.find((item) => item.id === selectedId) ?? null;

  const submit = useMutation({
    mutationFn: () =>
      createServiceRequest({ data: { catalogItemId: selectedId!, title, description } }),
    onSuccess: async (request) => {
      toast.success(`Ticket ${request.number} created.`, {
        description: [
          request.groupName ? `Routed to ${request.groupName}` : "Awaiting team assignment",
          request.priority ? PRIORITY_LABELS[request.priority] : null,
          request.dueAt ? `target ${new Date(request.dueAt).toLocaleDateString()}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      setSelectedId(null);
      setTitle("");
      setDescription("");
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/requests", search: { record: request.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The request was not submitted."),
  });

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        eyebrow="Self-service"
        title="Service catalogue"
        description="Choose a service, tell us what you need, and a request ticket is created and routed automatically."
      />

      <ReportIssue initialCategory={params.issue} />

      <h2 className="mt-10 text-lg font-semibold text-foreground">Request something</h2>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search services"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search services"
          className="sm:max-w-sm"
        />
        <select
          aria-label="Category"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {reference.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No services found" hint="Try a different search or category." />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  if (!title) setTitle(item.name);
                }}
                aria-pressed={item.id === selectedId}
                className={`rounded-lg border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  item.id === selectedId ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/60"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {item.category}
                </p>
                <p className="mt-1 font-semibold text-foreground">{item.name}</p>
                {item.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  Delivery in {item.delivery_days} day{item.delivery_days === 1 ? "" : "s"} ·{" "}
                  {item.approval_required ? "Approval required" : "No approval needed"}
                </p>
              </button>
            ))}
          </div>

          <aside className="h-fit rounded-lg border border-border bg-card p-5 xl:sticky xl:top-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a service to start your request.
              </p>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit.mutate();
                }}
              >
                <div>
                  <p className="text-xs text-muted-foreground">{selected.category}</p>
                  <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-title">Summary</Label>
                  <Input
                    id="cat-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    minLength={5}
                    maxLength={160}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-details">Details</Label>
                  <Textarea
                    id="cat-details"
                    rows={5}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Who is it for, when do you need it, any specifics?"
                    minLength={5}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={submit.isPending}>
                    {submit.isPending ? "Submitting…" : "Submit request"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>
                    Cancel
                  </Button>
                </div>
                {canRoute ? (
                  <RoutingEditor
                    key={selected.id}
                    itemId={selected.id}
                    groupId={selected.default_group_id}
                    priority={selected.default_priority}
                    groups={(reference.data?.groups ?? []).map((g) => ({ id: g.id, name: g.name }))}
                  />
                ) : null}
              </form>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function ReportIssue({ initialCategory }: { initialCategory?: string | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<string | null>(
    INCIDENT_CATEGORIES.some((c) => c.value === initialCategory) ? initialCategory! : null,
  );
  const [subcategory, setSubcategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState(3);
  const [urgency, setUrgency] = useState(3);
  const current = INCIDENT_CATEGORIES.find((c) => c.value === category);

  const submit = useMutation({
    mutationFn: () =>
      createSelfServiceIncident({
        data: {
          title,
          description,
          impact,
          urgency,
          category,
          subcategory: subcategory || null,
        },
      }),
    onSuccess: async (incident) => {
      toast.success(`Incident ${incident.number} created.`);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/incidents", search: { record: incident.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The ticket was not created."),
  });

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-foreground">Report an issue</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Something broken? Pick an area and an incident ticket is opened for the service desk.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {INCIDENT_CATEGORIES.map((c) => (
          <Button
            key={c.value}
            size="sm"
            variant={category === c.value ? "default" : "outline"}
            aria-pressed={category === c.value}
            onClick={() => {
              setCategory(category === c.value ? null : c.value);
              setSubcategory("");
            }}
          >
            {c.label}
          </Button>
        ))}
      </div>
      {current ? (
        <form
          className="mt-4 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="issue-sub">What is affected</Label>
            <select
              id="issue-sub"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
            >
              <option value="">Not sure</option>
              {current.subcategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="issue-impact">Who is affected</Label>
              <select
                id="issue-impact"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={impact}
                onChange={(e) => setImpact(Number(e.target.value))}
              >
                <option value={3}>Just me</option>
                <option value={2}>My team</option>
                <option value={1}>Many people</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue-urgency">How urgent</Label>
              <select
                id="issue-urgency"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={urgency}
                onChange={(e) => setUrgency(Number(e.target.value))}
              >
                <option value={3}>Can wait</option>
                <option value={2}>Slowing me down</option>
                <option value={1}>Can't work</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="issue-title">Summary</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              minLength={5}
              maxLength={160}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="issue-details">What happened</Label>
            <Textarea
              id="issue-details"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Error messages, when it started, what you've tried"
              minLength={5}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Creating ticket…" : "Create incident ticket"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
