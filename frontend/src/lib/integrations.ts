// Catalog of the integrations the API actually supports. Connection details live in the API's environment
// (secrets never pass through the browser), so each entry says which setting turns it on.

export type ChannelKey = "monitoring" | "pagerduty" | "scanner" | "slack" | "teams" | "email" | "assistant";
export type EndpointKey = "alerts" | "pagerduty" | "scanner";
export type Category = "monitoring" | "incident" | "security" | "communication" | "ai";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "monitoring", label: "Monitoring & alerting" },
  { value: "incident", label: "Incident response" },
  { value: "security", label: "Security" },
  { value: "communication", label: "Communication" },
  { value: "ai", label: "AI" },
];

export type Integration = {
  key: ChannelKey;
  name: string;
  category: Category;
  /** One line under the name. */
  summary: string;
  /** What happens once it is connected. */
  description: string;
  /** API environment variables; the first one decides "connected". */
  settings: string[];
  /** Senders post here (webhooks only). */
  endpoint?: EndpointKey;
  /** The Test connection button can send a real test message. */
  testable?: boolean;
  /** Sample request a sender would make, with {url} for the endpoint. */
  example?: string;
  /** Tools that commonly send to this integration. */
  worksWith?: string[];
};

export const INTEGRATIONS: Integration[] = [
  {
    key: "monitoring",
    name: "Monitoring alerts",
    category: "monitoring",
    summary: "Turn alerts into incidents",
    description:
      "Alerts posted with a bearer token become monitoring incidents. A repeat of the same alert updates the open incident instead of creating another.",
    settings: ["MONITORING_WEBHOOK_TOKEN"],
    endpoint: "alerts",
    worksWith: ["Prometheus Alertmanager", "Grafana", "Zabbix", "Any webhook"],
    example:
      'curl -X POST {url} \\\n  -H "Authorization: Bearer $MONITORING_WEBHOOK_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"alerts":[{"status":"firing","labels":{"alertname":"HighCPU","severity":"critical","instance":"web-01"}}]}\'',
  },
  {
    key: "pagerduty",
    name: "PagerDuty",
    category: "incident",
    summary: "Sync on-call incidents",
    description:
      "Signed v3 webhooks for triggered, acknowledged, resolved and reopened incidents. Each PagerDuty incident links to one workspace incident, and retries never create duplicates.",
    settings: ["PAGERDUTY_WEBHOOK_SECRET"],
    endpoint: "pagerduty",
    worksWith: ["PagerDuty webhooks v3"],
  },
  {
    key: "scanner",
    name: "Security scanners",
    category: "security",
    summary: "Import vulnerability findings",
    description:
      "Signed findings from scanners. The same scanner, reference and asset update one finding, and approved fix plans are kept when a scan repeats.",
    settings: ["SECURITY_SCANNER_SECRET"],
    endpoint: "scanner",
    worksWith: ["Vulnerability scanners", "CI security checks"],
  },
  {
    key: "slack",
    name: "Slack",
    category: "communication",
    summary: "Announce urgent incidents",
    description: "Priority 1 monitoring incidents and major incident declarations are posted to a Slack channel.",
    settings: ["SLACK_WEBHOOK_URL"],
    testable: true,
    worksWith: ["Slack incoming webhooks"],
  },
  {
    key: "teams",
    name: "Microsoft Teams",
    category: "communication",
    summary: "Announce urgent incidents",
    description: "Priority 1 monitoring incidents and major incident declarations are posted to a Teams channel.",
    settings: ["TEAMS_WEBHOOK_URL"],
    testable: true,
    worksWith: ["Teams incoming webhooks"],
  },
  {
    key: "email",
    name: "Email",
    category: "communication",
    summary: "Notification digests by email",
    description:
      "Everyone with new notifications gets one digest email every few minutes, unless they turned email off in their profile. Notifications already read in the app are skipped.",
    settings: ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL"],
    testable: true,
    worksWith: ["Any SMTP server"],
  },
  {
    key: "assistant",
    name: "Support assistant",
    category: "ai",
    summary: "Answer questions, draft tickets",
    description:
      "Answers employee questions from the knowledge base and drafts tickets for them to confirm. Nothing is created until the employee agrees.",
    settings: ["ANTHROPIC_API_KEY"],
    worksWith: ["Anthropic API"],
  },
];

/** Integrations in a category (or all) whose name, summary, description or tools match the search. */
export function filterIntegrations(items: Integration[], category: Category | "all", query: string): Integration[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    const haystack = [item.name, item.summary, item.description, ...(item.worksWith ?? [])].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
