import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { AppShell, useWorkspace } from "@/components/app-shell";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getIntegrationStatus } from "@/lib/integrations.functions";
import { canManage, type AppRole } from "@/lib/itsm-shared";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — WeCrew ITSM" },
      { name: "description", content: "Connect Prometheus, Grafana, scanners, Slack, Teams and trackers to WeCrew incidents." },
      { property: "og:title", content: "Integrations — WeCrew ITSM" },
      { property: "og:description", content: "Inbound monitoring alerts and outbound ChatOps for WeCrew." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Integrations,
});

const BASE = "https://all-levels-joy.lovable.app";
type Key = "monitoring" | "scanner" | "slack" | "teams";
const INBOUND: { name: string; key: Key; endpoint: string; setup: string }[] = [
  { name: "Prometheus Alertmanager", key: "monitoring", endpoint: "/api/public/alerts", setup: "receivers: webhook_configs: url + http_config.authorization.credentials = your token" },
  { name: "Grafana Alerting", key: "monitoring", endpoint: "/api/public/alerts", setup: "Contact point → Webhook, Authorization header: Bearer <token>" },
  { name: "Generic webhook (Datadog, CloudWatch, Sentry, Zabbix…)", key: "monitoring", endpoint: "/api/public/alerts", setup: '{"name","status":"firing|resolved","severity","instance","summary"}' },
  { name: "Security scanners (Trivy, Snyk, Qualys)", key: "scanner", endpoint: "/api/public/security-findings", setup: "x-wecrew-signature: sha256=<HMAC of body>" },
];
const OUTBOUND: { name: string; key: Key | null; note: string }[] = [
  { name: "Slack", key: "slack", note: "Critical alert incidents post to your incoming webhook." },
  { name: "Microsoft Teams", key: "teams", note: "Critical alert incidents post to your Teams webhook." },
  { name: "Jira / GitHub / Linear", key: null, note: "Planned — reference issue keys in incident and change notes for now." },
];

function Integrations() {
  const workspace = useWorkspace();
  const roles = (workspace.data?.roles ?? []) as AppRole[];
  const staff = canManage(roles);
  const status = useQuery({ queryKey: ["integration-status"], queryFn: () => getIntegrationStatus(), enabled: staff });
  const badge = (k: Key | null) =>
    k === null ? <span className="text-xs text-muted-foreground">Planned</span>
    : status.isPending ? <span className="text-xs text-muted-foreground">Checking…</span>
    : status.data?.[k] ? <span className="text-xs font-medium text-success">Connected</span>
    : <span className="text-xs text-muted-foreground">Awaiting credential</span>;
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast.success("Copied."); } catch { toast.error("Could not copy."); } };

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader eyebrow="Platform" title="Integrations" description="Turn monitoring alerts into incidents and notify your team where they work." />
      {!staff ? <div className="mt-6"><EmptyState title="Staff access required" hint="Integrations are managed by workspace staff." /></div> : (
        <>
          <h2 className="mt-8 text-sm font-semibold">Inbound — alerts become incidents</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {INBOUND.map((i) => (
              <div key={i.name} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{i.name}</p>{badge(i.key)}</div>
                <div className="mt-2 flex items-center gap-1">
                  <code className="min-w-0 break-all text-xs text-muted-foreground">POST {BASE}{i.endpoint}</code>
                  <Button size="icon" variant="ghost" aria-label="Copy endpoint" onClick={() => copy(BASE + i.endpoint)}><Copy className="size-4" /></Button>
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground">{i.setup}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Firing alerts open an incident routed to Platform Operations (critical → P1). Repeats are deduplicated; resolved alerts add a note for staff to close.</p>
          <h2 className="mt-8 text-sm font-semibold">Outbound — notifications</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {OUTBOUND.map((o) => (
              <div key={o.name} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{o.name}</p>{badge(o.key)}</div>
                <p className="mt-2 text-xs text-muted-foreground">{o.note}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
