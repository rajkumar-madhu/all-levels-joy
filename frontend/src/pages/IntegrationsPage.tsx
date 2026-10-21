import { Check, Copy, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useIntegrationStatus, useRecheckIntegrations, type ToolState } from "@/api/integrations";
import { Badge, Button, PageHeader, Panel, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime } from "@/lib/format";

const STATE: Record<ToolState, { label: string; tone: "good" | "bad" | "muted" }> = {
  up: { label: "Active", tone: "good" },
  down: { label: "Unreachable", tone: "bad" },
  absent: { label: "Not installed", tone: "muted" },
};

export function IntegrationsPage() {
  const workspace = useWorkspace();
  const isAdmin = workspace.roles.includes("admin");
  const status = useIntegrationStatus(workspace.id, isAdmin);
  const recheck = useRecheckIntegrations(workspace.id);
  const [checking, setChecking] = useState(false);

  if (!isAdmin) return <StateMessage kind="error">Only administrators can view integrations.</StateMessage>;

  const s = status.data;
  return (
    <>
      <PageHeader
        eyebrow="Governance and knowledge"
        title="Integrations"
        description="Which intake channels are configured, where senders post, and whether connected tools respond. Secret values are never shown."
        actions={
          <Button
            variant="secondary"
            busy={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await recheck();
              } finally {
                setChecking(false);
              }
            }}
          >
            <RefreshCw className="size-4" /> Check again
          </Button>
        }
      />
      {status.isPending ? (
        <StateMessage kind="loading">Checking integrations…</StateMessage>
      ) : status.isError ? (
        <StateMessage kind="error">{status.error.message}</StateMessage>
      ) : (
        s && (
          <>
            <p className="text-xs text-muted-foreground">Last checked {formatDateTime(s.checkedAt)}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Channel name="Monitoring alerts" on={s.channels.monitoring} setting="MONITORING_WEBHOOK_TOKEN" url={s.endpoints.alerts}>
                Prometheus Alertmanager, Grafana or any webhook posts alerts with a bearer token. Repeats update the same
                open incident.
              </Channel>
              <Channel name="PagerDuty" on={s.channels.pagerduty} setting="PAGERDUTY_WEBHOOK_SECRET" url={s.endpoints.pagerduty}>
                Signed v3 webhook for triggered, acknowledged, resolved and reopened incidents.
              </Channel>
              <Channel name="Security scanners" on={s.channels.scanner} setting="SECURITY_SCANNER_SECRET" url={s.endpoints.scanner}>
                Signed findings. The same scanner, reference and asset update one finding instead of creating duplicates.
              </Channel>
              <Channel name="Slack" on={s.channels.slack} setting="SLACK_WEBHOOK_URL">
                Priority 1 monitoring incidents are announced in Slack.
              </Channel>
              <Channel name="Microsoft Teams" on={s.channels.teams} setting="TEAMS_WEBHOOK_URL">
                Priority 1 monitoring incidents are announced in Teams.
              </Channel>
              <Channel name="Support assistant" on={s.channels.assistant} setting="ANTHROPIC_API_KEY">
                Answers employee questions from the knowledge base and drafts tickets for them to confirm.
              </Channel>
            </div>

            <Panel className="p-4">
              <h2 className="text-sm font-semibold">Scheduled jobs</h2>
              <ul className="mt-2 grid gap-1 text-sm">
                {s.scheduledJobs.map((job) => (
                  <li key={job.name}>
                    {job.name} <span className="text-muted-foreground">· {job.schedule} (Celery beat)</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[36rem]">
                <thead>
                  <tr>
                    <th className={th}>Tool</th>
                    <th className={th}>Kind</th>
                    <th className={th}>Status</th>
                    <th className={th}>Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.tools.map((tool) => (
                    <tr key={tool.name}>
                      <td className="px-4 py-2 font-medium">{tool.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{tool.kind}</td>
                      <td className="px-4 py-2">
                        <Badge tone={STATE[tool.state].tone}>{STATE[tool.state].label}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        {tool.url.startsWith("https://") ? (
                          <a href={tool.url} target="_blank" rel="noreferrer noopener" className="text-primary underline">
                            {new URL(tool.url).host}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        )
      )}
    </>
  );
}

function Channel({ name, on, setting, url, children }: { name: string; on: boolean; setting: string; url?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <Panel className="grid content-start gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{name}</h2>
        <Badge tone={on ? "good" : "muted"}>{on ? "Configured" : "Not configured"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
      {!on && (
        <p className="text-xs text-muted-foreground">
          Set <code className="font-mono">{setting}</code> on the API to enable it.
        </p>
      )}
      {url && (
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{url}</code>
          <button
            aria-label={`Copy ${name} URL`}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // Clipboard refused; the URL stays visible to copy by hand.
              }
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
      )}
    </Panel>
  );
}
