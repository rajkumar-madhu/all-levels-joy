import { Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useArticles } from "@/api/hooks";
import { Badge, Button, Input, PageHeader, Panel, StateMessage } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, humanize } from "@/lib/format";

export function KnowledgePage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const articles = useArticles(workspace.id, q);

  return (
    <>
      <PageHeader eyebrow="Governance and knowledge" title="Knowledge" description="Answers and how-to guides for common problems." />
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(draft.trim() ? { q: draft.trim() } : {}, { replace: true });
        }}
      >
        <Input id="knowledge-search" aria-label="Search articles" placeholder="Search titles, summaries and tags" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button variant="secondary" type="submit" aria-label="Search">
          <Search className="size-4" />
        </Button>
      </form>
      {articles.isPending ? (
        <StateMessage kind="loading">Loading articles…</StateMessage>
      ) : articles.isError ? (
        <StateMessage kind="error">{articles.error.message}</StateMessage>
      ) : articles.data.length === 0 ? (
        <StateMessage kind="empty">No articles found{q ? ` for “${q}”` : ""}.</StateMessage>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {articles.data.map((a) => (
            <Link key={a.id} to={`/knowledge/${a.id}`}>
              <Panel className="grid h-full gap-2 p-4 hover:border-primary">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{a.number}</span>
                  {a.status !== "published" && <Badge tone="warn">{humanize(a.status)}</Badge>}
                  <span className="ml-auto">Updated {formatDateTime(a.updated_at)}</span>
                </div>
                <h2 className="font-semibold">{a.title}</h2>
                {a.summary && <p className="line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
                {!!a.tags?.length && (
                  <div className="flex flex-wrap gap-1">
                    {a.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                )}
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
