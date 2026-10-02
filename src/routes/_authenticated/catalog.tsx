import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { createServiceRequest } from "@/lib/itsm.functions";
import { referenceQuery } from "@/lib/workspace-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/catalog")({
  head: () => ({
    meta: [
      { title: "Service catalogue — WeCrew ITSM" },
      {
        name: "description",
        content: "Browse available IT services and submit a request that opens a tracked ticket.",
      },
      { property: "og:title", content: "Service catalogue — WeCrew ITSM" },
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
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      toast.success(`Ticket ${request.number} created.`);
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

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
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
              </form>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
