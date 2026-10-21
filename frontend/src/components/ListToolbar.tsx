import { Search } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Input } from "./ui";

export type StateFilter = { value: string; label: string };

export const OPEN_RECORD_STATES = "new,open,in_progress,pending";
export const RECORD_FILTERS: StateFilter[] = [
  { value: OPEN_RECORD_STATES, label: "Open" },
  { value: "resolved,closed", label: "Done" },
  { value: "all", label: "All" },
];

/** List filters kept in the URL so a filtered view can be bookmarked or shared. */
export function useListParams(defaultState: string) {
  const [params, setParams] = useSearchParams();
  const state = params.get("state") ?? defaultState;
  const q = params.get("q") ?? "";
  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v);
      else merged.delete(k);
    }
    setParams(merged, { replace: true });
  };
  // "all" is a UI choice only; the API treats a missing filter as all states.
  return { state, q, apiState: state === "all" ? "" : state, update };
}

export function ListToolbar({
  id,
  filters,
  state,
  q,
  placeholder,
  update,
}: {
  id: string;
  filters: StateFilter[];
  state: string;
  q: string;
  placeholder: string;
  update: (next: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState(q);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Filter by state" className="flex rounded-md border border-slate-300 dark:border-slate-700">
        {filters.map((f) => (
          <button
            key={f.label}
            onClick={() => update({ state: f.value })}
            aria-pressed={state === f.value}
            className="px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md aria-pressed:bg-brand-600 aria-pressed:text-white"
          >
            {f.label}
          </button>
        ))}
      </div>
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() });
        }}
      >
        <Input id={id} aria-label={placeholder} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button variant="secondary" type="submit" aria-label="Search">
          <Search className="size-4" />
        </Button>
      </form>
    </div>
  );
}
