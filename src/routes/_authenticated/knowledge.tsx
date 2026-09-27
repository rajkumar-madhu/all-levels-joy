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
import { referenceQuery } from "@/lib/workspace-queries";
import { formatDateTime, type AppRole } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const knowledgeSearchSchema = z.object({
  record: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  category: fallback(z.string(), "all").default("all"),
  status: fallback(z.string(), "all").default("all"),
});

export const Route = createFileRoute("/_authenticated/knowledge")({
  validateSearch: zodValidator(knowledgeSearchSchema),
  head: () => ({
    meta: [
      { title: "Knowledge base — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Draft, review, and publish knowledge articles that resolve repeat demand and support self-service.",
      },
      { property: "og:title", content: "Knowledge base — WeCrew ITSM" },
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
  category: "How-to",
  status: "draft",
};

function Knowledge() {
  const workspace = useWorkspace();
  const reference = useQuery(referenceQuery());
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [editor, setEditor] = useState<typeof emptyArticle | null>(null);

  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];
  const canAuthor = roles.some((role) =>
    ["service_desk", "fulfiller", "manager", "admin", "change_manager"].includes(role),
  );
  const allArticles = reference.data?.knowledge ?? [];
  const visibleArticles = canAuthor
    ? allArticles
    : allArticles.filter((article) => article.status === "published");
  const categories = [...new Set(visibleArticles.map((article) => article.category))].sort();
  const safeStatus = ["all", "draft", "review", "published", "retired"].includes(search.status)
    ? search.status
    : "all";
  const normalizedQuery = search.q.trim().toLocaleLowerCase();
  const articles = visibleArticles.filter((article) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [article.number, article.title, article.summary, article.category, article.content]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery));
    const matchesCategory = search.category === "all" || article.category === search.category;
    const matchesStatus = safeStatus === "all" || article.status === safeStatus;
    return matchesQuery && matchesCategory && matchesStatus;
  });
  const selected = visibleArticles.find((item) => item.id === search.record) ?? null;
  const hasFilters = search.q.length > 0 || search.category !== "all" || safeStatus !== "all";

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
          category: editor?.category ?? "How-to",
          status: editor?.status ?? "draft",
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
            <Button size="sm" onClick={() => setEditor(editor ? null : { ...emptyArticle })}>
              {editor ? "Cancel" : "New article"}
            </Button>
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
                void navigate({ search: { record: "", q: "", category: "all", status: "all" } })
              }
            >
              <X className="h-4 w-4" aria-hidden /> Clear
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {articles.length} {articles.length === 1 ? "article" : "articles"} found
        </p>
      </section>

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
            <Input
              id="kb-category"
              value={editor.category}
              onChange={(event) => setEditor({ ...editor, category: event.target.value })}
              required
            />
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
                        })
                      }
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{selected.title}</h2>
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
