import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

const INTERNAL_TOOLS: Array<{
  name: string;
  kind: string;
  url: string;
  probe?: string;
  state?: "up" | "down" | "absent";
}> = [
  { name: "Prometheus", kind: "Metrics", url: "", probe: "http://prometheus.wecrew-observatory.svc.cluster.local:9090/-/healthy" },
  { name: "Grafana", kind: "Dashboards", url: "https://ops.wecrew.in", probe: "http://wecrew-ops-grafana.wecrew-ops.svc.cluster.local/api/health" },
  { name: "VictoriaMetrics", kind: "Metrics", url: "https://ops.wecrew.in", probe: "http://victoria-metrics.wecrew-ops.svc.cluster.local:8428/health" },
  { name: "Alertmanager", kind: "Alerts", url: "https://ops.wecrew.in", probe: "http://wecrew-ops-alertmanager.wecrew-ops.svc.cluster.local:9093/-/ready" },
  { name: "Tempo", kind: "Traces", url: "https://ops.wecrew.in", probe: "http://wecrew-ops-tempo.wecrew-ops.svc.cluster.local:3100/ready" },
  { name: "OpenSearch", kind: "Logs", url: "", probe: "http://opensearch.wecrew-logs.svc.cluster.local:9200/" },
  { name: "Zabbix", kind: "Monitoring", url: "", state: "absent" },
  { name: "Elasticsearch", kind: "Logs", url: "", state: "absent" },
  { name: "Logstash", kind: "Logs", url: "", state: "absent" },
  { name: "Kibana", kind: "Logs", url: "", state: "absent" },
  { name: "Jenkins", kind: "CI", url: "https://jenkins.wecrew.in" },
  { name: "Gitea", kind: "Source", url: "https://gitea.wecrew.in" },
  { name: "Harbor", kind: "Registry", url: "https://harbor.wecrew.in" },
  { name: "n8n", kind: "Automation", url: "https://n8n-admin.wecrew.in" },
  { name: "Keycloak", kind: "Identity", url: "https://keycloak.wecrew.in" },
  { name: "DevOps Nexus", kind: "Platform", url: "https://app.wecrew.in" },
  { name: "Observatory", kind: "Observability", url: "https://observatory.wecrew.in" },
  { name: "CronGuard", kind: "Schedules", url: "https://cronguard.wecrew.in" },
  { name: "Alertmind", kind: "Alerts", url: "https://alertmind.wecrew.in" },
  { name: "Infra assets", kind: "CMDB", url: "https://infraasset.wecrew.in" },
  { name: "Ops", kind: "Operations", url: "https://ops.wecrew.in" },
  { name: "Docs", kind: "Docs", url: "https://docs.wecrew.in" },
];

async function probe(url: string): Promise<"up" | "down" | "absent"> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return response.status > 0 && response.status < 500 ? "up" : "down";
  } catch {
    return "down";
  }
}

async function readIntegrationStatus() {
  const [tools, database] = await Promise.all([
    Promise.all(
      INTERNAL_TOOLS.map(async (tool) => ({
        name: tool.name,
        kind: tool.kind,
        url: tool.url,
        state: tool.state ?? (await probe(tool.probe ?? tool.url)),
      })),
    ),
    probe("http://local-supabase:8000/auth/v1/health"),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    pagerduty: Boolean(process.env["PAGERDUTY_WEBHOOK_SECRET"]),
    monitoring: Boolean(process.env["MONITORING_WEBHOOK_TOKEN"]),
    slack: Boolean(process.env["SLACK_WEBHOOK_URL"]),
    teams: Boolean(process.env["TEAMS_WEBHOOK_URL"]),
    scanner: Boolean(process.env["SECURITY_SCANNER_SECRET"]),
    cron: Boolean(process.env["LOVABLE_CRON_SECRET"]),
    tools: [
      { name: "Workspace Auth API", kind: "Identity", url: "", state: database },
      ...tools,
    ],
  };
}

type IntegrationStatus = Awaited<ReturnType<typeof readIntegrationStatus>>;
let cachedStatus: { expiresAt: number; value: IntegrationStatus } | undefined;
let pendingStatus: Promise<IntegrationStatus> | undefined;

async function getCachedIntegrationStatus() {
  if (cachedStatus && cachedStatus.expiresAt > Date.now()) return cachedStatus.value;
  const pending = pendingStatus ?? (pendingStatus = readIntegrationStatus());
  try {
    const value = await pending;
    cachedStatus = { expiresAt: Date.now() + 30_000, value };
    return value;
  } finally {
    if (pendingStatus === pending) pendingStatus = undefined;
  }
}

export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { force?: boolean } | undefined) => input?.force === true)
  .handler(async ({ data: force, context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _org_id: DEMO_ORG_ID,
      _role: "admin",
      _user_id: context.userId,
    });
    if (error || !data) throw new Error("Only administrators can view integrations.");
    if (force) {
      cachedStatus = undefined;
      pendingStatus = undefined;
    }
    return getCachedIntegrationStatus();
  });
