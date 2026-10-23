import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { saveKnowledgeArticle } from "@/lib/itsm.functions";
import { listKnowledgeCategories, saveKnowledgeCategory } from "@/lib/knowledge.functions";
import { referenceQuery } from "@/lib/workspace-queries";
import { canAuthorKnowledge, formatDateTime, type AppRole } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const knowledgeSearchSchema = z.object({
  record: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  category: fallback(z.string(), "all").default("all"),
  status: fallback(z.string(), "all").default("all"),
  tag: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/knowledge")({
  validateSearch: zodValidator(knowledgeSearchSchema),
  head: () => ({
    meta: [
      { title: "Knowledge base — Argus Service Desk" },
      {
        name: "description",
        content:
          "Draft, review, and publish knowledge articles that resolve repeat demand and support self-service.",
      },
      { property: "og:title", content: "Knowledge base — Argus Service Desk" },
      {
        property: "og:description",
        content: "Knowledge articles with draft, review, and published states.",
      },
    ],
  }),
  component: Knowledge,
});

const emptyArticle = {
  id: null as string | null,
  title: "",
  summary: "",
  content: "",
  category: "",
  status: "draft",
  tags: "",
};

function Knowledge() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [editor, setEditor] = useState<typeof emptyArticle | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const categoryQuery = useQuery({
    queryKey: ["knowledge-categories"],
    queryFn: () => listKnowledgeCategories(),
  });
  const categoryRows = categoryQuery.data ?? [];
  const activeCategories = categoryRows.filter((row) => row.active).map((row) => row.name);

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const canAuthor = canAuthorKnowledge(roles);
  const canManageCategories = canAuthor;
  const allArticles = reference.data?.knowledge ?? [];
  const visibleArticles = canAuthor
    ? allArticles
    : allArticles.filter((article) => article.status === "published");
  const categories = [
    ...new Set([...activeCategories, ...visibleArticles.map((article) => article.category)]),
  ].filter(
    (name) => activeCategories.includes(name) || visibleArticles.some((a) => a.category === name),
  );
  const allTags = [...new Set(visibleArticles.flatMap((article) => article.tags ?? []))].sort();
  const safeStatus = ["all", "draft", "review", "published", "retired"].includes(search.status)
    ? search.status
    : "all";
  const normalizedQuery = search.q.trim().toLocaleLowerCase();
  const articles = visibleArticles.filter((article) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [
        article.number,
        article.title,
        article.summary,
        article.category,
        article.content,
        ...(article.tags ?? []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery));
    const matchesCategory = search.category === "all" || article.category === search.category;
    const matchesStatus = safeStatus === "all" || article.status === safeStatus;
    const matchesTag = !search.tag || (article.tags ?? []).includes(search.tag);
    return matchesQuery && matchesCategory && matchesStatus && matchesTag;
  });
  const selected = visibleArticles.find((item) => item.id === search.record) ?? null;
  const hasFilters =
    search.q.length > 0 || search.category !== "all" || safeStatus !== "all" || search.tag !== "";

  const updateSearch = (patch: Partial<typeof search>) => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const save = useMutation({
    mutationFn: () =>
      saveKnowledgeArticle({
        data: {
          id: editor?.id ?? null,
          title: editor?.title ?? "",
          summary: editor?.summary ?? "",
          content: editor?.content ?? "",
          category: editor?.category || activeCategories[0] || "General",
          status: editor?.status ?? "draft",
          tags: (editor?.tags ?? "")
            .split(",")
            .map((tag) =>
              tag
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 40),
            )
            .filter(Boolean),
        },
      }),
    onSuccess: async () => {
      toast.success("Article saved.");
      setEditor(null);
      await queryClient.invalidateQueries({ queryKey: ["reference"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The article was not saved."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Knowledge management"
        title="Knowledge base"
        description="Published articles reduce repeat incidents. Drafts and reviews stay visible to authors only in listing order."
        actions={
          canAuthor ? (
            <div className="flex gap-2">
              {canManageCategories ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setManagingCategories((v) => !v)}
                >
                  {managingCategories ? "Close categories" : "Manage categories"}
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setEditor(editor ? null : { ...emptyArticle })}>
                {editor ? "Cancel" : "New article"}
              </Button>
            </div>
          ) : null
        }
      />

      <section className="mt-6 border-y border-border bg-muted/25 px-4 py-4 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_180px_auto]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search knowledge articles"
              placeholder="Search articles, topics, or article numbers"
              value={search.q}
              onChange={(event) => updateSearch({ q: event.target.value, record: "" })}
              className="pl-9"
            />
          </div>
          <select
            aria-label="Filter by category"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={search.category}
            onChange={(event) => updateSearch({ category: event.target.value, record: "" })}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {canAuthor ? (
            <select
              aria-label="Filter by publication status"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={safeStatus}
              onChange={(event) => updateSearch({ status: event.target.value, record: "" })}
            >
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="review">In review</option>
              <option value="retired">Retired</option>
            </select>
          ) : null}
          {hasFilters ? (
            <Button
              variant="outline"
              onClick={() =>
                void navigate({
                  search: { record: "", q: "", category: "all", status: "all", tag: "" },
                })
              }
            >
              <X className="h-4 w-4" aria-hidden /> Clear
            </Button>
          ) : null}
        </div>
        {allTags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Filter by tag">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => updateSearch({ tag: search.tag === tag ? "" : tag, record: "" })}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  search.tag === tag
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">
          {articles.length} {articles.length === 1 ? "article" : "articles"} found
        </p>
      </section>

      {managingCategories ? (
        <CategoryManager
          rows={categoryRows}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["knowledge-categories"] })}
          onRenamed={() => queryClient.invalidateQueries({ queryKey: ["reference"] })}
        />
      ) : null}

      {editor ? (
        <form
          className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-title">Title</Label>
            <Input
              id="kb-title"
              value={editor.title}
              onChange={(event) => setEditor({ ...editor, title: event.target.value })}
              minLength={5}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-category">Category</Label>
            <select
              id="kb-category"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={editor.category || activeCategories[0] || ""}
              onChange={(event) => setEditor({ ...editor, category: event.target.value })}
              required
            >
              {[
                ...new Set([...activeCategories, ...(editor.category ? [editor.category] : [])]),
              ].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-status">Status</Label>
            <select
              id="kb-status"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={editor.status}
              onChange={(event) => setEditor({ ...editor, status: event.target.value })}
            >
              {["draft", "review", "published", "retired"].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-tags">Tags (comma separated)</Label>
            <Input
              id="kb-tags"
              placeholder="vpn, remote, macos"
              value={editor.tags}
              onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-summary">Summary</Label>
            <Input
              id="kb-summary"
              value={editor.summary}
              onChange={(event) => setEditor({ ...editor, summary: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-content">Article</Label>
            <Textarea
              id="kb-content"
              rows={8}
              value={editor.content}
              onChange={(event) => setEditor({ ...editor, content: event.target.value })}
              minLength={10}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              Save article
            </Button>
          </div>
        </form>
      ) : null}

      {reference.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : visibleArticles.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No articles yet"
            hint="Write the first article to start the knowledge base."
          />
        </div>
      ) : articles.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No matching articles"
            hint="Try a different term or clear the filters."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <ul className="space-y-2">
            {articles.map((article) => (
              <li key={article.id}>
                <button
                  type="button"
                  onClick={() => updateSearch({ record: article.id })}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    article.id === search.record
                      ? "border-primary/50 bg-accent/40"
                      : "border-border bg-card hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{article.number}</span>
                    <span className="capitalize">{article.status}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{article.title}</p>
                  {article.summary ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {article.summary}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {article.category} · updated {formatDateTime(article.updated_at)}
                  </p>
                  {(article.tags ?? []).length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {(article.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <article className="rounded-lg border border-border bg-card p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select an article from the results to read it.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs text-muted-foreground">{selected.number}</p>
                  {canAuthor ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditor({
                          id: selected.id,
                          title: selected.title,
                          summary: selected.summary ?? "",
                          content: selected.content,
                          category: selected.category,
                          status: selected.status,
                          tags: (selected.tags ?? []).join(", "),
                        })
                      }
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.category}
                  {(selected.tags ?? []).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => updateSearch({ tag })}
                      className="ml-1.5 rounded-full bg-muted px-1.5 hover:bg-accent"
                    >
                      #{tag}
                    </button>
                  ))}
                </p>
                {selected.summary ? (
                  <p className="mt-1 text-sm text-muted-foreground">{selected.summary}</p>
                ) : null}
                <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {selected.content}
                </div>
              </>
            )}
          </article>
        </div>
      )}
    </AppShell>
  );
}

function CategoryManager({
  rows,
  onSaved,
  onRenamed,
}: {
  rows: { id: string; name: string; description: string | null; active: boolean }[];
  onSaved: () => Promise<void>;
  onRenamed: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({});
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const save = useMutation({
    mutationFn: (input: {
      id?: string | null;
      name: string;
      description?: string;
      active: boolean;
    }) => saveKnowledgeCategory({ data: input }),
    onSuccess: async () => {
      toast.success("Category saved.");
      setNewName("");
      setNewDescription("");
      await onSaved();
      await onRenamed();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Category was not saved."),
  });
  return (
    <section
      className="mt-6 space-y-3 rounded-lg border border-border bg-card p-5"
      aria-label="Manage categories"
    >
      <h2 className="text-sm font-semibold text-foreground">Categories</h2>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const draft = drafts[row.id] ?? { name: row.name, description: row.description ?? "" };
          return (
            <li
              key={row.id}
              className="grid gap-2 py-2 sm:grid-cols-[200px_1fr_auto_auto] sm:items-center"
            >
              <Input
                aria-label={`Name for ${row.name}`}
                value={draft.name}
                onChange={(e) =>
                  setDrafts({ ...drafts, [row.id]: { ...draft, name: e.target.value } })
                }
              />
              <Input
                aria-label={`Description for ${row.name}`}
                value={draft.description}
                onChange={(e) =>
                  setDrafts({ ...drafts, [row.id]: { ...draft, description: e.target.value } })
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    id: row.id,
                    name: draft.name,
                    description: draft.description,
                    active: row.active,
                  })
                }
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    id: row.id,
                    name: row.name,
                    description: row.description ?? "",
                    active: !row.active,
                  })
                }
              >
                {row.active ? "Retire" : "Restore"}
              </Button>
            </li>
          );
        })}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[200px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name: newName, description: newDescription, active: true });
        }}
      >
        <Input
          aria-label="New category name"
          placeholder="New category"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          minLength={2}
        />
        <Input
          aria-label="New category description"
          placeholder="Description"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <Button size="sm" type="submit" disabled={save.isPending}>
          Add category
        </Button>
      </form>
    </section>
  );
}
