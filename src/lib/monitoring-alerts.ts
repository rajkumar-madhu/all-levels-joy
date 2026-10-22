import { z } from "zod";

// Normalises Prometheus Alertmanager, Grafana and generic webhook payloads into one alert shape.
export type NormalizedAlert = {
  source: "prometheus" | "grafana" | "webhook";
  fingerprint: string;
  name: string;
  status: "firing" | "resolved";
  severity: string;
  instance: string | null;
  service: string | null;
  summary: string;
  link: string | null;
  startsAt: string | null;
};

export const MAX_ALERTS_PER_REQUEST = 25;
export const MAX_NEW_INCIDENTS_PER_WINDOW = 20;
export const RATE_WINDOW_MS = 10 * 60_000;
export const MIN_TOKEN_LENGTH = 32;

/** Keeps only hostname-safe characters; anything else is rejected (null). */
export function safeInstance(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().slice(0, 300);
  return /^[A-Za-z0-9.:-]+$/.test(v) ? v : null;
}

/** Keeps only http(s) links. */
export function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

const str = z.string().max(2000);
const labels = z.record(z.string(), z.string().max(500)).default({});

const amAlert = z.object({
  status: z.enum(["firing", "resolved"]),
  labels,
  annotations: labels,
  startsAt: str.optional(),
  generatorURL: str.optional(),
  fingerprint: str.optional(),
  dashboardURL: str.optional(),
  panelURL: str.optional(),
  silenceURL: str.optional(),
});

const amPayload = z.object({
  receiver: str.optional(),
  status: z.enum(["firing", "resolved"]).optional(),
  alerts: z.array(amAlert).min(1).max(MAX_ALERTS_PER_REQUEST),
  orgId: z.union([z.number(), z.string()]).optional(),
  title: str.optional(),
});

const genericPayload = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(["firing", "resolved"]).default("firing"),
  severity: z.string().max(40).default("warning"),
  fingerprint: z.string().trim().min(1).max(200).optional(),
  instance: z.string().max(300).optional(),
  service: z.string().max(200).optional(),
  summary: z.string().max(4000).default(""),
  link: z.string().max(2000).optional(),
});

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 200) || "alert"
  );
}

export function parseAlertPayload(json: unknown): NormalizedAlert[] | null {
  const am = amPayload.safeParse(json);
  if (am.success) {
    const source =
      am.data.orgId !== undefined || am.data.alerts.some((a) => a.dashboardURL || a.panelURL)
        ? "grafana"
        : "prometheus";
    return am.data.alerts.map((a) => {
      const name =
        a.labels["alertname"] || a.labels["rulename"] || am.data.title || "Unnamed alert";
      const instance = safeInstance(a.labels["instance"] || a.labels["host"]);
      return {
        source,
        fingerprint: slug(a.fingerprint || `${name}|${instance ?? ""}|${a.labels["job"] ?? ""}`),
        name: name.slice(0, 200),
        status: a.status,
        severity: (a.labels["severity"] || "warning").toLowerCase(),
        instance,
        service: a.labels["service"] || a.labels["job"] || null,
        summary: (a.annotations["summary"] || a.annotations["description"] || "").slice(0, 4000),
        link: safeLink(a.dashboardURL || a.panelURL || a.generatorURL),
        startsAt: a.startsAt ?? null,
      };
    });
  }
  const g = genericPayload.safeParse(json);
  if (g.success) {
    return [
      {
        source: "webhook",
        fingerprint: slug(g.data.fingerprint || `${g.data.name}|${g.data.instance ?? ""}`),
        name: g.data.name,
        status: g.data.status,
        severity: g.data.severity.toLowerCase(),
        instance: safeInstance(g.data.instance),
        service: g.data.service ?? null,
        summary: g.data.summary,
        link: safeLink(g.data.link),
        startsAt: null,
      },
    ];
  }
  return null;
}

/** Maps alert severity to incident impact/urgency (1 = highest). critical/page → P1. */
export function severityToImpact(severity: string): { impact: number; urgency: number } {
  if (["critical", "page", "p1", "disaster"].includes(severity)) return { impact: 1, urgency: 1 };
  if (["error", "high", "major", "p2"].includes(severity)) return { impact: 1, urgency: 2 };
  if (["warning", "warn", "medium", "p3"].includes(severity)) return { impact: 2, urgency: 2 };
  return { impact: 3, urgency: 3 };
}

export function alertMarker(alert: Pick<NormalizedAlert, "source" | "fingerprint">) {
  return `[alert:${alert.source}:${alert.fingerprint}]`;
}

export const ALERT_SOURCE_LABELS: Record<string, string> = {
  prometheus: "Prometheus Alertmanager",
  grafana: "Grafana",
  webhook: "Generic webhook",
};

/** Extracts the source from a monitoring incident's description marker. */
export function alertSourceOf(description: string): string | null {
  const m = description.match(/\[alert:([a-z]+):/);
  return m?.[1] ?? null;
}
