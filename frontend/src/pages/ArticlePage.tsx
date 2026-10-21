import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { useArticle } from "@/api/hooks";
import { PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime } from "@/lib/format";

export function ArticlePage() {
  const workspace = useWorkspace();
  const { articleId = "" } = useParams();
  const article = useArticle(workspace.id, articleId);

  if (article.isPending) return <StateMessage kind="loading">Loading article…</StateMessage>;
  if (article.isError) return <StateMessage kind="error">{article.error.message}</StateMessage>;
  const a = article.data;
  return (
    <>
      <Link to="/knowledge" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400">
        <ArrowLeft className="size-4" /> Knowledge base
      </Link>
      <PageHeader title={a.title} description={`${a.number} · version ${a.version} · updated ${formatDateTime(a.updated_at)}`} />
      <Panel className="p-6">
        {/* Article content is rendered as plain text; rich formatting needs a sanitising renderer first. */}
        <article className="max-w-prose text-sm leading-relaxed whitespace-pre-wrap">{a.content || a.summary || "This article has no content yet."}</article>
      </Panel>
    </>
  );
}
