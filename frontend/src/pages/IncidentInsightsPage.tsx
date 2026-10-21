import { Link } from "react-router";
import { useIncidentMetrics, type IncidentMetrics, type Tally } from "@/api/insights";
import { IncidentStateBadge, PriorityBadge } from "@/components/badges";
import { PageHeader, Panel, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { dueIn, humanize, priorityLabel } from "@/lib/format";
import { formatHours, niceMax } from "@/lib/insights";

export function IncidentInsightsPage() {
  const workspace = useWorkspace();
  const metrics = useIncidentMetrics(workspace.id);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Incident insights"
        description={
          workspace.is_staff
            ? "Volumes, response and resolution times, and the open backlog for the last 30 days."
            : "Your incidents over the last 30 days."
        }
      />
      {metrics.isPending ? (
        <StateMessage kind="loading">Loading insights…</StateMessage>
      ) : metrics.isError ? (
        <StateMessage kind="error">{metrics.error.message}</StateMessage>
      ) : (
        <Insights m={metrics.data} />
      )}
    </>
  );
}

function Insights({ m }: { m: IncidentMetrics }) {
  const kpis: { label: string; value: string; caption: string }[] = [
    { label: "Opened", value: String(m.opened), caption: `Last ${m.windowDays} days${m.sampledRecent ? " (first 1,000)" : ""}` },
    { label: "Resolved", value: String(m.resolved), caption: `${m.reopened} reopened` },
    { label: "Mean time to resolve", value: formatHours(m.mttrHours), caption: "Opened to resolved" },
    { label: "Mean first response", value: formatHours(m.responseHours), caption: "Opened to first response" },
    {
      label: "SLA attainment",
      value: m.slaAttainment === null ? "—" : `${Math.round(m.slaAttainment)}%`,
      caption: "Resolved within target",
    },
    { label: "Open backlog", value: String(m.openTotal), caption: `${m.unassigned} unassigned` },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((k) => (
          <Panel key={k.label} className="p-4">
            <p className="text-sm">{k.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.caption}</p>
          </Panel>
        ))}
      </div>

      <Panel className="p-4">
        <h2 className="text-sm font-semibold">Opened and resolved, last 14 days</h2>
        <DailyChart days={m.days} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Open incidents by priority</h2>
          <Bars rows={m.byPriority.map((p) => ({ label: priorityLabel(p.priority), count: p.open }))} />
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Open incidents by service</h2>
          <Bars rows={m.serviceLoad} empty="No open incidents." />
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Opened by category</h2>
          <Bars rows={m.byCategory.map((t) => ({ ...t, label: humanize(t.label) }))} empty="No incidents in this period." />
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Raised via</h2>
          <Bars rows={m.byContactType.map((t) => ({ ...t, label: humanize(t.label) }))} empty="No incidents in this period." />
        </Panel>
        <Panel className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Resolved by close code</h2>
          <Bars rows={m.byCloseCode.map((t) => ({ ...t, label: humanize(t.label) }))} empty="Nothing resolved in this period." />
        </Panel>
      </div>

      <Panel className="overflow-x-auto">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Oldest open incidents</h2>
        {m.ageing.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No open incidents.</p>
        ) : (
          <table className="w-full min-w-[44rem]">
            <thead>
              <tr>
                <th className={th}>Incident</th>
                <th className={th}>Priority</th>
                <th className={th}>State</th>
                <th className={th}>Service</th>
                <th className={th}>Age</th>
                <th className={th}>SLA target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {m.ageing.map((row) => {
                const due = dueIn(row.slaDueAt);
                return (
                  <tr key={row.id} className="hover:bg-accent">
                    <td className="max-w-80 px-4 py-2">
                      <Link className="font-mono text-xs text-primary hover:underline" to={`/incidents/${row.id}`}>
                        {row.number}
                      </Link>
                      <p className="truncate">{row.title}</p>
                    </td>
                    <td className="px-4 py-2"><PriorityBadge priority={row.priority} /></td>
                    <td className="px-4 py-2"><IncidentStateBadge state={row.state} /></td>
                    <td className="px-4 py-2 text-muted-foreground">{row.service ?? "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{row.ageDays}d</td>
                    <td className={`px-4 py-2 tabular-nums ${due.overdue ? "text-destructive" : ""}`}>{due.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/** Horizontal bars on one shared scale; every count is printed beside its bar. */
function Bars({ rows, empty = "No data." }: { rows: Tally[]; empty?: string }) {
  if (!rows.length || rows.every((r) => r.count === 0)) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-2.5 rounded-sm bg-muted">
            <span className="block h-full rounded-sm bg-primary" style={{ width: `${max ? (r.count / max) * 100 : 0}%` }} />
          </span>
          <span className="text-right tabular-nums">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

const CHART = { width: 720, height: 220, left: 36, right: 8, top: 12, bottom: 28 };

/** Paired daily bars drawn to scale; axis ticks are whole numbers the data actually spans. */
function DailyChart({ days }: { days: IncidentMetrics["days"] }) {
  const max = niceMax(Math.max(1, ...days.map((d) => Math.max(d.opened, d.resolved))));
  const ticks = [0, max / 2, max].filter((v, i, all) => Number.isInteger(v) && all.indexOf(v) === i);
  const plotW = CHART.width - CHART.left - CHART.right;
  const plotH = CHART.height - CHART.top - CHART.bottom;
  const slot = plotW / days.length;
  const barW = Math.max(3, slot * 0.32);
  const y = (v: number) => CHART.top + plotH - (v / max) * plotH;

  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="h-auto w-full min-w-[32rem]" role="img" aria-label="Incidents opened and resolved per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" />
            <text x={CHART.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted-foreground)">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = CHART.left + i * slot + slot / 2;
          return (
            <g key={d.day}>
              <rect x={x - barW - 1} y={y(d.opened)} width={barW} height={CHART.top + plotH - y(d.opened)} fill="var(--color-primary)">
                <title>{`${d.day}: ${d.opened} opened`}</title>
              </rect>
              <rect x={x + 1} y={y(d.resolved)} width={barW} height={CHART.top + plotH - y(d.resolved)} fill="var(--color-success)">
                <title>{`${d.day}: ${d.resolved} resolved`}</title>
              </rect>
              {i % 2 === 1 && (
                <text x={x} y={CHART.height - 8} textAnchor="middle" fontSize="11" fill="var(--color-muted-foreground)">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" aria-hidden /> Opened
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" aria-hidden /> Resolved
        </span>
      </div>
    </div>
  );
}
