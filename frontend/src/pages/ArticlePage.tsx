import { ArrowLeft, Pencil } from "lucide-react";
import { Link, useParams } from "react-router";
import { useArticle } from "@/api/hooks";
import { Badge, PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";
import { KNOWLEDGE_AUTHOR_ROLES, hasAnyRole } from "@/lib/roles";

export function ArticlePage() {
  const workspace = useWorkspace();
  const { articleId = "" } = useParams();
  const article = useArticle(workspace.id, articleId);

  if (article.isPending) return <StateMessage kind="loading">Loading article…</StateMessage>;
  if (article.isError) return <StateMessage kind="error">{article.error.message}</StateMessage>;
  const a = article.data;
  return (
    <>
      <Link to="/knowledge" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Knowledge
      </Link>
      <PageHeader
        title={a.title}
        description={`${a.number} · version ${a.version} · updated ${formatDateTime(a.updated_at)}`}
        actions={
          hasAnyRole(workspace.roles, KNOWLEDGE_AUTHOR_ROLES) && (
            <Link to={`/knowledge/${a.id}/edit`} className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm hover:bg-accent">
              <Pencil className="size-4" /> Edit
            </Link>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        {a.status !== "published" && <Badge tone={a.status === "retired" ? "muted" : "warn"}>{humanize(a.status)}</Badge>}
        {a.category && <Badge tone="info">{a.category}</Badge>}
        {(a.tags ?? []).map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>
      <Panel className="p-6">
        {/* Article content is rendered as plain text; rich formatting needs a sanitising renderer first. */}
        <article className="max-w-prose text-sm leading-relaxed whitespace-pre-wrap">{a.content || a.summary || "This article has no content yet."}</article>
      </Panel>
    </>
  );
}
