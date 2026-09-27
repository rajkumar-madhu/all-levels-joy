import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Inbox,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import {
  INCIDENT_QUEUES,
  type IncidentQueue,
  type IncidentQueueFilters,
} from "@/lib/incident-queue";
import { formatDateTime } from "@/lib/itsm-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PriorityBadge, SlaBadge, StateBadge } from "@/components/status-badge";

type Incident = Database["public"]["Tables"]["incidents"]["Row"];
type NamedItem = { id: string; name: string };
type Props = {
  incidents: Incident[];
  total: number | undefined;
  pageSize: number;
  counts: Record<IncidentQueue, number> | undefined;
  countsError: boolean;
  filters: IncidentQueueFilters;
  onFilters: (patch: Partial<IncidentQueueFilters>) => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  updatedAt: number;
  selectedId?: string | undefined;
  groups: NamedItem[];
  services: NamedItem[];
  people: { id: string; display_name: string }[];
};

const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-xs text-foreground";

export function IncidentWorkbench(props: Props) {
  const { filters, onFilters } = props;
  const [query, setQuery] = useState(filters.q);
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  useEffect(() => setQuery(filters.q), [filters.q]);
  useEffect(() => setCopied(false), [filters, props.selectedId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const queue = INCIDENT_QUEUES.find((item) => item.value === filters.queue)!;
  const hasFilters =
    filters.q || filters.priority !== "all" || filters.group !== "all" || filters.service !== "all";
  const total = props.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / props.pageSize));
  const groupName = (id: string | null) =>
    props.groups.find((item) => item.id === id)?.name ?? (id ? "Assigned group" : "No group");
  const ownerName = (id: string | null) =>
    props.people.find((item) => item.id === id)?.display_name ??
    (id ? "Assigned colleague" : "Unassigned");

  return (
    <section aria-label="Incident workbench" className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {(
          [
            {
              queue: "active",
              label: "Active incidents",
              icon: Inbox,
              note: "Awaiting resolution",
              tone: "text-foreground",
            },
            {
              queue: "unassigned",
              label: "Needs an owner",
              icon: UserRound,
              note: "Ready for triage",
              tone: "text-foreground",
            },
            {
              queue: "at_risk",
              label: "Due within 1 hour",
              icon: Clock3,
              note: "Resolution target approaching",
              tone: "text-warning",
            },
            {
              queue: "breached",
              label: "Overdue incidents",
              icon: AlertCircle,
              note: "Resolution target missed",
              tone: "text-destructive",
            },
          ] as const
        ).map((metric) => (
          <button
            key={metric.queue}
            type="button"
            onClick={() => onFilters({ queue: metric.queue, page: 1 })}
            aria-pressed={filters.queue === metric.queue}
            className={cn(
              "rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50",
              filters.queue === metric.queue ? "border-primary/45 shadow-sm" : "border-border",
            )}
          >
            <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              {metric.label}
              <metric.icon className="h-4 w-4" aria-hidden />
            </span>
            <span
              className={cn(
                "mt-3 block text-3xl font-semibold tabular-nums tracking-tight",
                metric.tone,
              )}
            >
              {props.countsError ? "—" : (props.counts?.[metric.queue] ?? "…")}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">{metric.note}</span>
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Work queues</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Counts cover all records you can access. Filters apply to the list below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                } catch {
                  setCopied(false);
                  toast.error(
                    "Unable to copy the link. Copy the address from your browser instead.",
                  );
                }
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {copied ? "Link copied" : "Copy view link"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh incident queues"
              onClick={props.onRefresh}
              disabled={props.refreshing}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", props.refreshing && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
        <div
          className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2"
          aria-label="Incident queue views"
        >
          {INCIDENT_QUEUES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filters.queue === item.value}
              onClick={() => onFilters({ queue: item.value, page: 1 })}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium",
                filters.queue === item.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                  filters.queue === item.value ? "bg-primary/10" : "bg-muted",
                )}
              >
                {props.countsError ? "—" : (props.counts?.[item.value] ?? "…")}
              </span>
            </button>
          ))}
        </div>
        {props.countsError ? (
          <p role="status" className="px-4 pt-3 text-xs text-destructive">
            Queue totals are unavailable. Refresh to retry.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/25 p-3">
          <form
            className="relative flex min-w-0 flex-[1_1_260px] items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onFilters({ q: query.trim(), page: 1 });
            }}
          >
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-9 bg-background pl-9 text-xs"
              aria-label="Search incident number or title"
              placeholder="Search incident number or title…"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>
          <Filter className="ml-1 hidden h-3.5 w-3.5 text-muted-foreground sm:block" aria-hidden />
          <select
            className={selectClass}
            aria-label="Filter by priority"
            value={filters.priority}
            onChange={(event) =>
              onFilters({
                priority: event.target.value as IncidentQueueFilters["priority"],
                page: 1,
              })
            }
          >
            <option value="all">All priorities</option>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                Priority {p}
              </option>
            ))}
          </select>
          <select
            className={cn(selectClass, "max-w-44")}
            aria-label="Filter by assignment group"
            value={filters.group}
            onChange={(event) => onFilters({ group: event.target.value, page: 1 })}
          >
            <option value="all">All groups</option>
            <option value="unassigned">No group</option>
            {props.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            className={cn(selectClass, "max-w-44")}
            aria-label="Filter by affected service"
            value={filters.service}
            onChange={(event) => onFilters({ service: event.target.value, page: 1 })}
          >
            <option value="all">All services</option>
            {props.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onFilters({ q: "", priority: "all", group: "all", service: "all", page: 1 })
              }
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <span className="text-xs font-semibold">{queue.label}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {props.total !== undefined && !props.error
                ? `${total} matching ${total === 1 ? "incident" : "incidents"}`
                : props.error
                  ? "Records unavailable"
                  : "Loading records"}
            </span>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Sort incidents</span>
            <select
              className="rounded bg-transparent py-1 text-xs text-foreground"
              aria-label="Sort incidents"
              value={filters.sort}
              onChange={(event) =>
                onFilters({ sort: event.target.value as IncidentQueueFilters["sort"], page: 1 })
              }
            >
              <option value="sla">SLA due first</option>
              <option value="priority">Priority first</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
        {props.error ? (
          <div
            role="alert"
            className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-5"
          >
            <div>
              <p className="text-sm font-semibold">Unable to load incidents</p>
              <p className="mt-1 text-xs text-muted-foreground">{props.error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={props.onRefresh}>
              Try again
            </Button>
            {filters.page > 1 ? (
              <Button variant="outline" size="sm" onClick={() => onFilters({ page: 1 })}>
                Back to first page
              </Button>
            ) : null}
          </div>
        ) : props.loading ? (
          <div role="status" className="space-y-3 p-4">
            <span className="sr-only">Loading incidents</span>
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : props.incidents.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden />
            <h3 className="mt-4 text-sm font-semibold">
              {filters.page > pages
                ? "This page no longer has records"
                : "No incidents in this view"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasFilters
                ? "Try a broader search or clear your filters."
                : "Choose another queue or log an incident to get started."}
            </p>
            {filters.page > 1 ? (
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                onClick={() => onFilters({ page: 1 })}
              >
                Back to first page
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div
              className="divide-y divide-border border-t border-border md:hidden"
              aria-label="Incident cards"
            >
              {props.incidents.map((incident) => (
                <article
                  key={incident.id}
                  className={cn("p-4", props.selectedId === incident.id && "bg-primary/5")}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => props.onSelect(incident.id)}
                  >
                    <span className="flex items-center justify-between font-mono text-[11px] text-primary">
                      {incident.number}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="mt-2 block text-sm font-medium leading-snug">
                      {incident.title}
                    </span>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <PriorityBadge priority={incident.priority} />
                    <StateBadge state={incident.state} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {ownerName(incident.assignee_id)} · {groupName(incident.group_id)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <SlaBadge
                      dueAt={incident.sla_due_at}
                      resolvedAt={incident.resolved_at}
                      recordState={incident.state}
                      now={now}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {incident.sla_due_at
                        ? formatDateTime(incident.sla_due_at)
                        : "No resolution target"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            <div
              className="hidden overflow-x-auto md:block"
              tabIndex={0}
              role="region"
              aria-label="Scrollable incident results"
              aria-busy={props.refreshing}
            >
              <table className="w-full min-w-[850px] text-left text-sm">
                <caption className="sr-only">
                  {queue.label} incidents, page {filters.page}. Open an incident by its number or
                  description.
                </caption>
                <thead className="border-y border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {["Incident", "Priority / State", "Owner / Group", "Resolution SLA", ""].map(
                      (heading) => (
                        <th key={heading} scope="col" className="px-4 py-2.5 font-semibold">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {props.incidents.map((incident) => (
                    <tr
                      key={incident.id}
                      className={cn(
                        "group transition-colors hover:bg-primary/[0.025]",
                        props.selectedId === incident.id && "bg-primary/5",
                      )}
                    >
                      <td className="max-w-[360px] px-4 py-4">
                        <button
                          type="button"
                          className="block max-w-full text-left"
                          onClick={() => props.onSelect(incident.id)}
                        >
                          <span className="font-mono text-[10px] font-medium text-primary">
                            {incident.number}
                          </span>
                          <span className="mt-1 block truncate text-[13px] font-medium text-foreground group-hover:text-primary">
                            {incident.title}
                          </span>
                        </button>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {props.services.find((s) => s.id === incident.service_id)?.name ??
                            (incident.service_id
                              ? "Service details unavailable"
                              : "No service linked")}
                          <span className="mx-1.5">·</span>
                          {formatDateTime(incident.created_at)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col items-start gap-1.5">
                          <PriorityBadge priority={incident.priority} />
                          <StateBadge state={incident.state} />
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                              incident.assignee_id
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {incident.assignee_id ? (
                              ownerName(incident.assignee_id)
                                .split(" ")
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join("")
                            ) : (
                              <UserRound className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <div>
                            <p
                              className={cn(
                                "text-xs",
                                !incident.assignee_id && "text-muted-foreground",
                              )}
                            >
                              {ownerName(incident.assignee_id)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {groupName(incident.group_id)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <SlaBadge
                          dueAt={incident.sla_due_at}
                          resolvedAt={incident.resolved_at}
                          recordState={incident.state}
                          now={now}
                        />
                        <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
                          {incident.sla_due_at
                            ? formatDateTime(incident.sla_due_at)
                            : "No resolution target"}
                        </p>
                      </td>
                      <td className="px-2 py-4">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Open ${incident.number}`}
                          onClick={() => props.onSelect(incident.id)}
                        >
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span role="status">
            {props.error
              ? "Records unavailable"
              : props.loading
                ? "Loading…"
                : total === 0
                  ? "0 records"
                  : props.incidents.length === 0
                    ? `${total} records · page out of range`
                    : `${(filters.page - 1) * props.pageSize + 1}–${(filters.page - 1) * props.pageSize + props.incidents.length} of ${total}`}
            {props.updatedAt && !props.loading && !props.error ? (
              <span className="ml-3 hidden md:inline">
                Updated{" "}
                {new Date(props.updatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label="Previous page"
              disabled={filters.page <= 1 || props.loading}
              onClick={() => onFilters({ page: filters.page - 1 })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center tabular-nums">
              Page {filters.page} of {pages}
            </span>
            <Button
              size="icon"
              variant="outline"
              aria-label="Next page"
              disabled={filters.page >= pages || props.loading || !!props.error}
              onClick={() => onFilters({ page: filters.page + 1 })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Resolution targets use elapsed time, including time on hold. Queue data refreshes every 30
        seconds while this page is open.
      </p>
    </section>
  );
}
