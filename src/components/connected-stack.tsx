import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, Plug } from "lucide-react";
import { getIntegrationStatus } from "@/lib/integrations.functions";
import { ALERT_SOURCE_LABELS, alertSourceOf } from "@/lib/monitoring-alerts";
import { relativeTime } from "@/lib/itsm-shared";

type Incident = { id: string; number: string; title: string; description: string; contact_type: string | null; state: string; created_at: string; priority: number | null };
type Ci = { id: string; status: string; environment: string | null; criticality: string | null };

export function ConnectedStack({ incidents, assets }: { incidents: Incident[]; assets: Ci[] }) {
  const status = useQuery({ queryKey: ["integration-status"], queryFn: () => getIntegrationStatus() });
  const alerts = incidents.filter((i) => i.contact_type === "monitoring");
  const firing = alerts.filter((i) => !["resolved", "closed", "cancelled"].includes(i.state));
  const bySource = (s: string) => firing.filter((i) => alertSourceOf(i.description) === s).length;
  const degraded = assets.filter((a) => a.status !== "operational");
  const tiles = [
    { name: "Prometheus", on: status.data?.monitoring, count: bySource("prometheus"), unit: "firing" },
    { name: "Grafana", on: status.data?.monitoring, count: bySource("grafana"), unit: "firing" },
    { name: "Webhooks", on: status.data?.monitoring, count: bySource("webhook"), unit: "firing" },
    { name: "Security scanners", on: status.data?.scanner, count: null, unit: "" },
    { name: "Slack", on: status.data?.slack, count: null, unit: "" },
    { name: "Microsoft Teams", on: status.data?.teams, count: null, unit: "" },
  ];
  return (
    <section className="mt-8 grid gap-6 xl:grid-cols-3" aria-label="Connected stack">
      <div className="rounded-lg border border-border bg-card xl:col-span-2">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Plug className="size-4" />Connected stack</h2>
          <Link to="/integrations" className="text-xs underline underline-offset-4">Manage integrations</Link>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.name} className="bg-card p-3">
              <p className="text-xs text-muted-foreground">{t.name}</p>
              <p className={`mt-1 text-sm font-medium ${t.on ? "text-success" : "text-muted-foreground"}`}>
                {status.isPending ? "Checking…" : t.on ? "Connected" : "Not connected"}
              </p>
              {t.count !== null && t.on ? <p className="font-mono text-xs text-muted-foreground">{t.count} {t.unit}</p> : null}
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Activity className="size-3" />Recent alerts</h3>
          {alerts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No alerts received from monitoring yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {alerts.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to="/incidents" search={{ record: a.id } as never} className="min-w-0 truncate text-primary hover:underline">
                    <span className="font-mono">{a.number}</span> {a.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{ALERT_SOURCE_LABELS[alertSourceOf(a.description) ?? "webhook"]} · {relativeTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Boxes className="size-4" />Assets & CMDB</h2>
          <Link to="/assets" className="text-xs underline underline-offset-4">Open CMDB</Link>
        </div>
        <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">Configuration items</dt><dd className="font-mono text-xl">{assets.length}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Not operational</dt><dd className="font-mono text-xl text-warning">{degraded.length}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Production</dt><dd className="font-mono text-xl">{assets.filter((a) => a.environment === "production").length}</dd></div>
          <div><dt className="text-xs text-muted-foreground">High criticality</dt><dd className="font-mono text-xl">{assets.filter((a) => a.criticality === "high" || a.criticality === "critical").length}</dd></div>
        </dl>
      </div>
    </section>
  );
}
