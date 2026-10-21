import { ArrowLeft } from "lucide-react";
import { type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useArticle } from "@/api/hooks";
import { parseTags, useKnowledgeCategories, useSaveArticle, type ArticleStatus } from "@/api/knowledge";
import type { Article } from "@/api/types";
import { Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { KNOWLEDGE_AUTHOR_ROLES, hasAnyRole } from "@/lib/roles";

const STATUSES: { value: ArticleStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Draft", hint: "Only staff can see it." },
  { value: "review", label: "In review", hint: "Ready for another author to check." },
  { value: "published", label: "Published", hint: "Everyone in the workspace can read it." },
  { value: "retired", label: "Retired", hint: "Hidden from readers; kept for history." },
];

/** /knowledge/new and /knowledge/:articleId/edit */
export function ArticleEditorPage() {
  const workspace = useWorkspace();
  const { articleId } = useParams();

  if (!hasAnyRole(workspace.roles, KNOWLEDGE_AUTHOR_ROLES))
    return <StateMessage kind="error">Only service desk, engineers, managers and administrators can write articles.</StateMessage>;
  return articleId ? <EditExisting orgId={workspace.id} articleId={articleId} /> : <Editor orgId={workspace.id} />;
}

function EditExisting({ orgId, articleId }: { orgId: string; articleId: string }) {
  const existing = useArticle(orgId, articleId);
  if (existing.isPending) return <StateMessage kind="loading">Loading article…</StateMessage>;
  if (existing.isError) return <StateMessage kind="error">{existing.error.message}</StateMessage>;
  // Keyed on updated_at so a reload after a conflict starts from the latest saved version.
  return <Editor key={existing.data.updated_at} orgId={orgId} article={existing.data} />;
}

function Editor({ orgId, article }: { orgId: string; article?: Article }) {
  const navigate = useNavigate();
  const categories = useKnowledgeCategories(orgId);
  const save = useSaveArticle(orgId, article?.id);
  const active = (categories.data ?? []).filter((c) => c.active || c.name === article?.category);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");
    save.mutate(
      {
        title: text("title").trim(),
        summary: text("summary").trim(),
        content: text("content"),
        category: text("category"),
        status: text("status") as ArticleStatus,
        tags: parseTags(text("tags")),
        ...(article ? { expectedUpdatedAt: article.updated_at } : {}),
      },
      { onSuccess: (saved) => navigate(`/knowledge/${saved.id}`) },
    );
  };

  return (
    <>
      <Link to={article ? `/knowledge/${article.id}` : "/knowledge"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {article ? article.number : "Knowledge"}
      </Link>
      <PageHeader title={article ? `Edit ${article.number}` : "New article"} description="Write for the person who has the problem right now: short steps, plain words." />
      <Panel className="p-5">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
          <div className="md:col-span-2">
            <Field label="Title">
              <Input id="article-title" name="title" required minLength={5} maxLength={160} defaultValue={article?.title} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Summary" hint="One or two sentences shown in search results.">
              <Textarea id="article-summary" name="summary" maxLength={400} rows={2} defaultValue={article?.summary ?? ""} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Content">
              <Textarea id="article-content" name="content" required minLength={10} maxLength={20000} rows={14} defaultValue={article?.content ?? ""} />
            </Field>
          </div>
          <Field label="Category">
            <Select id="article-category" name="category" required defaultValue={article?.category ?? ""}>
              <option value="" disabled>Choose a category</option>
              {active.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select id="article-status" name="status" defaultValue={article?.status ?? "draft"}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label} — {s.hint}</option>)}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Tags" hint="Comma separated, up to 12.">
              <Input id="article-tags" name="tags" defaultValue={(article?.tags ?? []).join(", ")} placeholder="vpn, remote-access" />
            </Field>
          </div>
          {categories.data && active.length === 0 && (
            <p className="text-sm text-warning-foreground md:col-span-2">
              No active categories yet. <Link className="text-primary underline" to="/knowledge/categories">Create one</Link> first.
            </p>
          )}
          <div className="grid gap-2 md:col-span-2">
            <FormError error={save.error} />
            <div className="flex gap-2">
              <Button type="submit" busy={save.isPending}>{article ? "Save article" : "Create article"}</Button>
            </div>
          </div>
        </form>
      </Panel>
    </>
  );
}
