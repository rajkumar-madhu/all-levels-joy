import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { getIntegrationStatus } from "@/lib/integration-status.functions";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — WeCrew ITSM" },
      {
        name: "description",
        content: "How each workspace tool and external system connects.",
      },
    ],
  }),
  component: IntegrationsPage,
});

function origin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  } catch {
    toast.error("Clipboard access is unavailable. Copy the URL from your browser address bar.");
  }
}

function Status({
  on,
  onLabel = "Connected",
  offLabel = "Secret not set",
}: {
  on: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <span
      className={
        on
          ? "rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
          : "rounded-md border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground"
      }
    >
      {on ? onLabel : offLabel}
    </span>
  );
}

function Tool({
  name,
  status,
  onLabel,
  offLabel,
  summary,
  lands,
  steps,
}: {
  name: string;
  status?: boolean;
  onLabel?: string;
  offLabel?: string;
  summary: string;
  lands: string;
  steps: string[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="font-sans text-sm font-semibold text-foreground">{name}</h2>
        {status === undefined ? null : (
          <Status
            on={status}
            {...(onLabel ? { onLabel } : {})}
            {...(offLabel ? { offLabel } : {})}
          />
        )}
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="text-muted-foreground">{summary}</p>
        <p>
          <span className="font-medium text-foreground">Shows up in </span>
          <span className="text-foreground">{lands}</span>
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-foreground">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}

type Category = "all" | "monitoring" | "itsm" | "communication" | "automation" | "cloud";
type Live = "up" | "down" | "absent";

function categoryOf(name: string): Exclude<Category, "all"> {
  if (
    [
      "Prometheus",
      "Grafana",
      "VictoriaMetrics",
      "Alertmanager",
      "Tempo",
      "OpenSearch",
      "Zabbix",
      "Elasticsearch",
      "Logstash",
      "Kibana",
      "Observatory",
      "Alertmind",
      "CronGuard",
    ].includes(name)
  ) {
    return "monitoring";
  }
  if (["n8n"].includes(name)) return "automation";
  if (["Docs", "Keycloak", "Workspace Auth API"].includes(name)) return "communication";
  if (["Ops", "Harbor", "Infra assets"].includes(name)) return "cloud";
  return "itsm";
}

function liveStatus(state: Live): "ACTIVE" | "INACTIVE" | "ERROR" {
  if (state === "up") return "ACTIVE";
  if (state === "down") return "ERROR";
  return "INACTIVE";
}

function CatalogCard({
  tool,
}: {
  tool: { name: string; kind: string; url: string; state: "up" | "down" | "absent" };
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {categoryOf(tool.name)}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{tool.name}</p>
        </div>
        <Status
          on={tool.state === "up"}
          onLabel="Responding"
          offLabel={tool.state === "absent" ? "Not installed" : "Unreachable"}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{tool.kind}</p>
      <p className="mt-3 truncate font-mono text-[11px] text-primary">
        {tool.url ? tool.url.replace("https://", "") : "Inside the platform"}
      </p>
    </>
  );
  const className = "block h-full rounded-lg border border-border bg-card p-4 hover:bg-muted/50";
  return tool.url ? (
    <a href={tool.url} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

function IntegrationsPage() {
  const [category, setCategory] = useState<Category>("all");
  const [live, setLive] = useState<"all" | "ACTIVE" | "INACTIVE" | "ERROR">("all");
  const forceNextCheck = useRef(false);
  const workspace = useWorkspace();
  const status = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => {
      const force = forceNextCheck.current;
      forceNextCheck.current = false;
      return getIntegrationStatus({ data: { force } });
    },
    enabled: workspace.isSuccess,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const base = origin();
  const pagerduty = `${base}/api/public/pagerduty`;
  const alerts = `${base}/api/public/alerts`;
  const scanner = `${base}/api/public/security-findings`;
  const cron = `${base}/api/public/security-exceptions-expire`;
  const tools = status.data?.tools ?? [];
  const catalog = useMemo(() => {
    return tools.filter((tool) => {
      const statusName = liveStatus(tool.state);
      const matchesCategory = category === "all" || categoryOf(tool.name) === category;
      const matchesStatus = live === "all" || statusName === live;
      return matchesCategory && matchesStatus;
    });
  }, [tools, category, live]);
  const counts = {
    tools: tools.length,
    active: tools.filter((tool) => tool.state === "up").length,
    inactive: tools.filter((tool) => tool.state === "absent").length,
    errors: tools.filter((tool) => tool.state === "down").length,
  };

  return (
    <AppShell workspace={workspace.data}>
      {workspace.isPending || status.isPending ? (
        <WorkspaceLoading />
      ) : workspace.isError || !workspace.data ? null : status.isError ? (
        <p className="text-sm text-destructive">{status.error.message}</p>
      ) : (
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="rounded-lg bg-sidebar px-6 py-6 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              Operate · connections
            </p>
            <h1 className="mt-2 text-4xl text-white">Integrations</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/75">
              Monitor workspace tool reachability and manage the inbound connections that create
              operational records.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ["Tools", counts.tools, "in the catalogue"],
                ["Responding", counts.active, "HTTP endpoint answered"],
                ["Inactive", counts.inactive, "not installed"],
                ["Errors", counts.errors, "need attention"],
                ["Showing", catalog.length, "after filters"],
              ].map(([label, value, sub]) => (
                <div key={String(label)} className="rounded-md border border-white/15 px-3 py-3">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-white/60">{label}</dt>
                  <dd className="mt-1 font-mono text-3xl text-white">{value}</dd>
                  <p className="text-[11px] text-white/60">{sub}</p>
                </div>
              ))}
            </dl>
          </section>
          <p className="text-xs text-muted-foreground">
            <Link to="/dashboard" className="underline underline-offset-4">Operations</Link>
            <span className="px-2">/</span>
            Integrations
          </p>
          {status.data?.checkedAt ? (
            <p className="text-xs text-muted-foreground">
              Last checked{" "}
              <time dateTime={status.data.checkedAt}>
                {new Date(status.data.checkedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "All"],
                ["monitoring", "Monitoring"],
                ["itsm", "ITSM"],
                ["communication", "Comms"],
                ["automation", "Automation"],
                ["cloud", "Cloud"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                aria-pressed={category === value}
                className={
                  category === value
                    ? "rounded-md bg-sidebar px-3 py-1.5 text-xs font-semibold text-white"
                    : "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
                }
              >
                {label}
              </button>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            {(
              [
                ["all", "All status"],
                ["ACTIVE", "Reachable"],
                ["INACTIVE", "Inactive"],
                ["ERROR", "Error"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLive(value)}
                aria-pressed={live === value}
                className={
                  live === value
                    ? "rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
                    : "rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                }
              >
                {label}
              </button>
            ))}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {catalog.length} integration{catalog.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => {
                forceNextCheck.current = true;
                void status.refetch();
              }}
              disabled={status.isFetching}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-60"
            >
              {status.isFetching ? "Checking…" : "Check now"}
            </button>
          </div>
          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No integration matches those filters.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {catalog.map((tool) => (
                <li key={tool.name}>
                  <CatalogCard tool={tool} />
                </li>
              ))}
            </ul>
          )}

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-sans text-sm font-semibold text-foreground">Inbound webhook</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                PagerDuty sends signed incident events here. Security scanners use their separate signed endpoint.
              </p>
              <button type="button" onClick={() => void copy(pagerduty)} className="mt-3 text-xs text-primary underline underline-offset-4">
                Copy incident webhook
              </button>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-sans text-sm font-semibold text-foreground">Outbound</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Critical alert incidents post to Slack
                {status.data?.slack ? " (webhook configured)" : " when SLACK_WEBHOOK_URL is set"} and to Microsoft
                Teams
                {status.data?.teams ? " (webhook configured)" : " when TEAMS_WEBHOOK_URL is set"}.
              </p>
              <Link to="/dashboard" className="mt-3 inline-block text-xs text-primary underline underline-offset-4">
                Back to the platform dashboard
              </Link>
            </div>
          </section>
          <Tool
            name="Prometheus and Grafana"
            status={status.data?.monitoring}
            onLabel="Token configured"
            summary="Firing alerts open an incident for Platform Operations. A repeat of the same alert is deduplicated, and a resolved alert adds a note for staff to close. Critical alerts are P1."
            lands="Incidents."
            steps={[
              `Point Alertmanager or a Grafana contact point at ${alerts}.`,
              "Send Authorization: Bearer with MONITORING_WEBHOOK_TOKEN.",
              'Body shape: {"name","status":"firing|resolved","severity","instance","summary"}.',
            ]}
          />
          <button
            type="button"
            onClick={() => void copy(alerts)}
            className="text-xs text-primary underline underline-offset-4"
          >
            Copy alerts URL
          </button>
          <Tool
            name="PagerDuty"
            status={status.data?.pagerduty}
            onLabel="Secret configured"
            summary="Incidents are created and updated when PagerDuty sends a signed webhook. The webhook secret stays on the server."
            lands="Incidents. Triggered opens an incident, acknowledged moves it to in progress, resolved records the supplied resolution note, and reopened reopens it."
            steps={[
              "In PagerDuty open Integrations, then Generic Webhooks (v3), then New Webhook.",
              `Set the URL to ${pagerduty}.`,
              "Configure PAGERDUTY_WEBHOOK_SECRET in the server environment. Never put this key in browser code or send it in the URL.",
              "Subscribe to incident.triggered, incident.acknowledged, incident.resolved, and incident.reopened.",
              "Only events after you save the webhook are imported. Older incidents still come from a CSV export.",
            ]}
          />
          <button
            type="button"
            onClick={() => void copy(pagerduty)}
            className="text-xs text-primary underline underline-offset-4"
          >
            Copy PagerDuty URL
          </button>
          <Tool
            name="Security scanners"
            status={status.data?.scanner}
            onLabel="Secret configured"
            summary="Scanners post findings. The same scanner, reference, and asset update one finding instead of creating duplicates."
            lands="Security findings."
            steps={[
              `POST JSON to ${scanner}.`,
              "Sign the raw body with HMAC-SHA256 and send the hex digest in the x-wecrew-signature header. The key is SECURITY_SCANNER_SECRET.",
              "Body shape: { findings: [{ scanner, reference, title, severity, description, asset }] }.",
              "Severity is critical, high, medium, or low. Send at most 100 findings per call.",
            ]}
          />
          <button
            type="button"
            onClick={() => void copy(scanner)}
            className="text-xs text-primary underline underline-offset-4"
          >
            Copy scanner URL
          </button>
          <Tool
            name="Exception expiry"
            status={status.data?.cron}
            onLabel="Secret configured"
            summary="A scheduled job reopens findings when an approved risk exception expires."
            lands="Security findings."
            steps={[
              `POST to ${cron} on a daily schedule.`,
              "Send Authorization: Bearer with the cron secret.",
              "The call returns how many exceptions expired.",
            ]}
          />
          <Tool
            name="Incidents, requests, and changes"
            summary="People and catalogue forms create these records. PagerDuty lands in the incident queue. Changes that need a decision create approvals."
            lands="Dashboard, Incidents, Service requests, Changes, and Approvals."
            steps={[
              "Raise an incident from Incidents or from a catalogue item.",
              "Request a catalogue item from Service catalogue. It becomes a service request.",
              "A change with approval required waits on the Approvals page before it can proceed.",
              "The dashboard is one scroll across those queues.",
            ]}
          />
          <Tool
            name="Problems, knowledge, and assets"
            summary="Repeated incidents can be tied to a problem. Published articles and configuration items are reference data for the same workspace."
            lands="Problems, Major incident command, Knowledge, and Assets."
            steps={[
              "Open Problems to track a root cause across incidents.",
              "Major incident command is for an active bridge.",
              "Publish a knowledge article so search and the dashboard can show it.",
              "Assets and CMDB hold the configuration items those records refer to.",
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Open the live queues from the{" "}
            <Link to="/dashboard" className="text-primary underline underline-offset-4">
              dashboard
            </Link>
            .
          </p>
        </div>
      )}
    </AppShell>
  );
}
