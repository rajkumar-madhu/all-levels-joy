import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { searchRecords } from "@/lib/itsm.functions";
import { STATE_LABELS, type RecordState } from "@/lib/itsm-shared";

type SearchResults = {
  incidents: { id: string; number: string; title: string; state: string }[];
  requests: { id: string; number: string; title: string; state: string }[];
  changes: { id: string; number: string; title: string; state: string }[];
  knowledge: { id: string; number: string; title: string; status: string }[];
  assets: { id: string; name: string }[];
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const enabled = debounced.length >= 2;
  const results = useQuery<SearchResults>({
    queryKey: ["search", debounced],
    queryFn: () => searchRecords({ data: { query: debounced } }) as Promise<SearchResults>,
    enabled,
    staleTime: 15_000,
  });

  const data = results.data;
  const total = data
    ? data.incidents.length + data.requests.length + data.changes.length + data.knowledge.length + data.assets.length
    : 0;

  const go = (to: "/incidents" | "/requests" | "/changes" | "/knowledge" | "/assets", recordId?: string) => {
    setOpen(false);
    setQuery("");
    if (recordId) {
      void navigate({ to, search: { record: recordId } });
    } else {
      void navigate({ to });
    }
  };

  const groups: { label: string; items: { key: string; title: string; meta: string; onSelect: () => void }[] }[] =
    data
      ? [
          {
            label: "Incidents",
            items: data.incidents.map((row) => ({
              key: `inc-${row.id}`,
              title: `${row.number} · ${row.title}`,
              meta: STATE_LABELS[row.state as RecordState] ?? row.state,
              onSelect: () => go("/incidents", row.id),
            })),
          },
          {
            label: "Service requests",
            items: data.requests.map((row) => ({
              key: `req-${row.id}`,
              title: `${row.number} · ${row.title}`,
              meta: STATE_LABELS[row.state as RecordState] ?? row.state,
              onSelect: () => go("/requests", row.id),
            })),
          },
          {
            label: "Changes",
            items: data.changes.map((row) => ({
              key: `chg-${row.id}`,
              title: `${row.number} · ${row.title}`,
              meta: STATE_LABELS[row.state as RecordState] ?? row.state,
              onSelect: () => go("/changes", row.id),
            })),
          },
          {
            label: "Knowledge",
            items: data.knowledge.map((row) => ({
              key: `kb-${row.id}`,
              title: `${row.number} · ${row.title}`,
              meta: row.status,
              onSelect: () => go("/knowledge"),
            })),
          },
          {
            label: "Assets",
            items: data.assets.map((row) => ({
              key: `ci-${row.id}`,
              title: row.name,
              meta: "Configuration item",
              onSelect: () => go("/assets"),
            })),
          },
        ].filter((group) => group.items.length > 0)
      : [];

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Search records, knowledge, assets…"
        aria-label="Search the workspace"
        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {open && enabled ? (
        <div className="absolute left-0 right-0 top-10 z-40 max-h-96 overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {results.isPending ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : total === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No matches for “{debounced}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="py-1">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.onSelect}
                    className="flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate text-foreground">{item.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
