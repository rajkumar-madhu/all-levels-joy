import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useSearch, type SearchResults } from "@/api/insights";
import { useActiveWorkspace } from "@/api/hooks";

type Hit = { key: string; to: string; label: string; detail: string };

/** Map each section to links the new app can open; sections without a screen here are listed without a link. */
function hits(results: SearchResults): { section: string; items: Hit[] }[] {
  return [
    { section: "Incidents", items: results.incidents.map((r) => ({ key: r.id, to: `/incidents/${r.id}`, label: r.number, detail: r.title })) },
    { section: "Service requests", items: results.requests.map((r) => ({ key: r.id, to: `/requests/${r.id}`, label: r.number, detail: r.title })) },
    { section: "Changes", items: results.changes.map((r) => ({ key: r.id, to: `/changes/${r.id}`, label: r.number, detail: r.title })) },
    { section: "Knowledge", items: results.knowledge.map((r) => ({ key: r.id, to: `/knowledge/${r.id}`, label: r.number, detail: r.title })) },
    { section: "Service catalogue", items: results.catalog.map((r) => ({ key: r.id, to: "/catalog", label: r.name, detail: r.category ?? "" })) },
    { section: "Security findings", items: results.security.map((r) => ({ key: r.id, to: `/security?finding=${r.id}`, label: r.number, detail: r.title })) },
    { section: "Assets", items: results.assets.map((r) => ({ key: r.id, to: "", label: r.name, detail: "" })) },
  ].filter((group) => group.items.length > 0);
}

export function GlobalSearch() {
  const workspace = useActiveWorkspace();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const location = useLocation();
  const search = useSearch(workspace?.id ?? "", workspace ? query : "");
  const groups = search.data ? hits(search.data) : [];
  const ready = query.trim().length >= 2;

  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative w-full max-w-md" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={open && ready}
        aria-controls={listId}
        aria-label="Search records, knowledge and assets"
        placeholder="Search records, knowledge, assets…"
        value={query}
        maxLength={80}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm placeholder:text-muted-foreground"
      />
      {open && ready && (
        <div
          id={listId}
          className="absolute top-11 right-0 left-0 z-40 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg"
        >
          {search.isError ? (
            <p role="alert" className="px-2 py-3 text-sm text-destructive">{search.error.message}</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground" role="status">
              {search.isFetching ? "Searching…" : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.section} className="py-1">
                <h3 className="px-2 py-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{group.section}</h3>
                <ul>
                  {group.items.map((hit) => (
                    <li key={hit.key}>
                      {hit.to ? (
                        <Link to={hit.to} className="flex gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                          <span className="shrink-0 font-mono text-xs text-primary">{hit.label}</span>
                          <span className="truncate">{hit.detail}</span>
                        </Link>
                      ) : (
                        <span className="flex gap-2 px-2 py-1.5 text-sm">{hit.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
