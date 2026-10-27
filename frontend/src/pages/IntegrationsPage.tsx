import { clsx } from "clsx";
import { Activity, Bot, Check, Copy, Hash, Mail, RefreshCw, Search, Send, ShieldAlert, Siren, Users, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useIntegrationStatus, useRecheckIntegrations, useTestIntegration, type IntegrationStatus, type ToolState } from "@/api/integrations";
import { Badge, Button, Input, PageHeader, Panel, StateMessage, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime } from "@/lib/format";
import { CATEGORIES, INTEGRATIONS, filterIntegrations, type Category, type ChannelKey, type Integration } from "@/lib/integrations";

const STATE: Record<ToolState, { label: string; tone: "good" | "bad" | "muted" }> = {
  up: { label: "Active", tone: "good" },
  down: { label: "Unreachable", tone: "bad" },
  absent: { label: "Not installed", tone: "muted" },
};

const ICONS: Record<ChannelKey, LucideIcon> = {
  monitoring: Activity,
  pagerduty: Siren,
  scanner: ShieldAlert,
  slack: Hash,
  teams: Users,
  email: Mail,
  assistant: Bot,
};

const COMPOSE = "docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d api worker beat";

export function IntegrationsPage() {
  const workspace = useWorkspace();
  const isAdmin = workspace.roles.includes("admin");
  const status = useIntegrationStatus(workspace.id, isAdmin);
  const recheck = useRecheckIntegrations(workspace.id);
  const [checking, setChecking] = useState(false);
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Integration | null>(null);

  if (!isAdmin) return <StateMessage kind="error">Only administrators can view integrations.</StateMessage>;

  const s = status.data;
  const shown = filterIntegrations(INTEGRATIONS, category, query);
  const connected = s ? INTEGRATIONS.filter((i) => s.channels[i.key]).length : 0;
  const tabs: { value: Category | "all"; label: string }[] = [{ value: "all", label: "All" }, ...CATEGORIES];

  return (
    <>
      <PageHeader
        eyebrow="Governance and knowledge"
        title="Integrations"
        description="Connect monitoring, on-call, scanners, chat, email and the assistant. Connection secrets stay on the server and are never shown here."
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid min-w-0 content-start gap-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-sm">
                  <span className="font-semibold">{connected}</span> of {INTEGRATIONS.length} connected
                </p>
                <p className="text-xs text-muted-foreground">Last checked {formatDateTime(s.checkedAt)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div role="tablist" aria-label="Categories" className="flex flex-wrap gap-1 rounded-md border border-input bg-card p-1">
                  {tabs.map((t) => {
                    const count = filterIntegrations(INTEGRATIONS, t.value, "").length;
                    return (
                      <button
                        key={t.value}
                        role="tab"
                        aria-selected={category === t.value}
                        onClick={() => setCategory(t.value)}
                        className="rounded px-3 py-1.5 text-sm aria-selected:bg-primary aria-selected:text-primary-foreground"
                      >
                        {t.label} <span className="opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
                  <Input
                    type="search"
                    aria-label="Search integrations"
                    placeholder="Search, e.g. Grafana or email"
                    className="pl-8"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              {shown.length === 0 ? (
                <StateMessage kind="empty">No integrations match. Try another word or category.</StateMessage>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {shown.map((item) => (
                    <IntegrationCard key={item.key} orgId={workspace.id} item={item} on={s.channels[item.key]} onOpen={() => setOpen(item)} />
                  ))}
                </div>
              )}
            </div>
            <aside className="grid min-w-0 content-start gap-4">
              <Panel className="p-4">
                <h2 className="text-sm font-semibold">How integrations work</h2>
                <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground">
                  <li>
                    Add the setting to <code className="font-mono text-xs">deploy/.env</code> on the server.
                  </li>
                  <li>Restart the API, worker and scheduler.</li>
                  <li>Select Check again. The card shows Connected.</li>
                  <li>Point the sender at the webhook address, or use Test connection.</li>
                </ol>
              </Panel>
              <Panel className="p-4">
                <h2 className="text-sm font-semibold">Scheduled jobs</h2>
                <ul className="mt-2 grid gap-1 text-sm">
                  {s.scheduledJobs.map((job) => (
                    <li key={job.name}>
                      {job.name} <span className="text-muted-foreground">· {job.schedule}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <ToolsPanel tools={s.tools} />
            </aside>
          </div>
        )
      )}
      {s && <SetupDialog item={open} status={s} onClose={() => setOpen(null)} />}
    </>
  );
}

function IntegrationCard({ orgId, item, on, onOpen }: { orgId: string; item: Integration; on: boolean; onOpen: () => void }) {
  const Icon = ICONS[item.key];
  const test = useTestIntegration(orgId);
  const result = test.data;
  return (
    <Panel className="grid content-start gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{item.name}</h2>
          <p className="text-xs text-muted-foreground">{item.summary}</p>
        </div>
        <Badge tone={on ? "good" : "muted"}>{on ? "Connected" : "Not connected"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{item.description}</p>
      {item.worksWith && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Works with">
          {item.worksWith.map((tool) => (
            <li key={tool} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {tool}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant={on ? "secondary" : "primary"} onClick={onOpen}>
          {on ? "Details" : "Set up"}
        </Button>
        {item.testable && on && (
          <Button variant="secondary" busy={test.isPending} onClick={() => test.mutate(item.key as "slack" | "teams" | "email")}>
            <Send className="size-4" /> Test connection
          </Button>
        )}
      </div>
      {(result || test.isError) && (
        <p role="status" className={clsx("text-sm", result?.ok ? "text-success" : "text-destructive")}>
          {result?.ok ? result.message : (result?.error ?? test.error?.message)}
        </p>
      )}
    </Panel>
  );
}

function SetupDialog({ item, status, onClose }: { item: Integration | null; status: IntegrationStatus; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  const url = item?.endpoint ? status.endpoints[item.endpoint] : undefined;
  const on = item ? status.channels[item.key] : false;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-labelledby="integration-dialog-title"
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-0 text-foreground backdrop:bg-black/40"
    >
      {item && (
        <div className="grid max-h-[85vh] gap-4 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="integration-dialog-title" className="text-lg font-semibold">
                {item.name}
              </h2>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            <button aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="size-5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={on ? "good" : "muted"}>{on ? "Connected" : "Not connected"}</Badge>
            <span className="text-xs text-muted-foreground">Last checked {formatDateTime(status.checkedAt)}</span>
          </div>

          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Settings</h3>
            <p className="text-sm text-muted-foreground">
              Add these to <code className="font-mono text-xs">deploy/.env</code> on the server. The first one turns the integration on.
            </p>
            <ul className="grid gap-1">
              {item.settings.map((name) => (
                <li key={name}>
                  <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{name}</code>
                </li>
              ))}
            </ul>
          </section>

          {url && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Webhook address</h3>
              <CopyField label={`${item.name} webhook address`} value={url} />
            </section>
          )}

          {item.example && url && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Example request</h3>
              <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{item.example.replace("{url}", url)}</pre>
            </section>
          )}

          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Steps</h3>
            <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
              <li>
                Set <code className="font-mono text-xs">{item.settings[0]}</code>
                {item.settings.length > 1 && " and the related settings"} in <code className="font-mono text-xs">deploy/.env</code>.
              </li>
              <li>
                Restart: <code className="font-mono text-xs break-all">{COMPOSE}</code>
              </li>
              <li>Close this window and select Check again.</li>
              <li>
                {url
                  ? "Point the sender at the webhook address above, using the same secret."
                  : item.testable
                    ? "Select Test connection on the card to send a real test message."
                    : "Open the feature and try it."}
              </li>
            </ol>
          </section>
        </div>
      )}
    </dialog>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{value}</code>
      <button
        aria-label={`Copy ${label}`}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard refused; the address stays visible to copy by hand.
          }
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function ToolsPanel({ tools }: { tools: IntegrationStatus["tools"] }) {
  return (
    <Panel className="overflow-x-auto">
      <h2 className="px-4 pt-4 text-sm font-semibold">Connected tools</h2>
      <table className="mt-2 w-full">
        <thead>
          <tr>
            <th className={th}>Tool</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tools.map((tool) => (
            <tr key={tool.name}>
              <td className="px-4 py-2">
                {tool.url.startsWith("https://") ? (
                  <a href={tool.url} target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline">
                    {tool.name}
                  </a>
                ) : (
                  <span className="font-medium">{tool.name}</span>
                )}
                <span className="block text-xs text-muted-foreground">{tool.kind}</span>
              </td>
              <td className="px-4 py-2">
                <Badge tone={STATE[tool.state].tone}>{STATE[tool.state].label}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
