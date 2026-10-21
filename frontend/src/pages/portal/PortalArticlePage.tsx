import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { usePublicArticle } from "@/api/portal";
import { Panel, StateMessage } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export function PortalArticlePage() {
  const { articleId = "" } = useParams();
  const article = usePublicArticle(articleId);
  if (article.isPending) return <StateMessage kind="loading">Loading article…</StateMessage>;
  if (article.isError) return <StateMessage kind="error">This article is not available.</StateMessage>;
  const a = article.data;
  return (
    <>
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Find an answer
      </Link>
      <div>
        <p className="font-mono text-xs text-muted-foreground">{a.number}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{a.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Published {formatDateTime(a.published_at)}</p>
      </div>
      <Panel className="p-6">
        {/* Plain text: article content is never interpreted as HTML. */}
        <article className="max-w-prose text-sm leading-relaxed whitespace-pre-wrap">{a.content || a.summary}</article>
      </Panel>
      <p className="text-sm text-muted-foreground">
        Still stuck? <Link to="/portal" className="text-primary underline">Raise a ticket</Link>.
      </p>
    </>
  );
}
