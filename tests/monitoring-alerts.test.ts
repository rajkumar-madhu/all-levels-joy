import { describe, expect, test } from "bun:test";
import { parseAlertPayload, severityToImpact, alertMarker } from "../src/lib/monitoring-alerts";

describe("monitoring alerts", () => {
  test("critical alerts map to P1 impact/urgency", () => {
    expect(severityToImpact("critical")).toEqual({ impact: 1, urgency: 1 });
    expect(severityToImpact("warning")).toEqual({ impact: 2, urgency: 2 });
    expect(severityToImpact("info")).toEqual({ impact: 3, urgency: 3 });
  });
  test("parses Prometheus Alertmanager payloads", () => {
    const a = parseAlertPayload({
      status: "firing",
      alerts: [
        {
          status: "firing",
          labels: { alertname: "HighCPU", instance: "web-01:9100", severity: "critical" },
          annotations: { summary: "CPU > 90%" },
          fingerprint: "abc",
        },
      ],
    });
    expect(a?.[0]).toMatchObject({
      source: "prometheus",
      name: "HighCPU",
      severity: "critical",
      fingerprint: "abc",
    });
  });
  test("detects Grafana payloads", () => {
    const a = parseAlertPayload({
      orgId: 1,
      alerts: [{ status: "resolved", labels: { alertname: "Latency" }, annotations: {} }],
    });
    expect(a?.[0].source).toBe("grafana");
    expect(a?.[0].status).toBe("resolved");
  });
  test("same alert yields same dedupe marker", () => {
    const p = { name: "Disk full", instance: "db-1" };
    expect(alertMarker(parseAlertPayload(p)![0])).toBe(alertMarker(parseAlertPayload(p)![0]));
  });
  test("rejects unknown payloads", () => {
    expect(parseAlertPayload({ foo: 1 })).toBeNull();
  });
});

import { safeInstance, safeLink, MAX_ALERTS_PER_REQUEST } from "../src/lib/monitoring-alerts";
describe("alert webhook hardening", () => {
  test("instance names with filter characters are dropped", () => {
    expect(safeInstance("web-01:9100")).toBe("web-01:9100");
    expect(safeInstance("x,service_id.neq.null")).toBeNull();
    expect(safeInstance("a)b")).toBeNull();
  });
  test("only http(s) links are kept", () => {
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("data:text/html,hi")).toBeNull();
    expect(safeLink("https://grafana.example.com/d/1")).toBe("https://grafana.example.com/d/1");
  });
  test("fingerprints contain no LIKE wildcards", () => {
    const a = parseAlertPayload({ name: "x", fingerprint: "a_b%c" })![0];
    expect(a.fingerprint).toMatch(/^[a-z0-9-]+$/);
  });
  test("batches over 25 alerts are rejected", () => {
    const one = { status: "firing", labels: { alertname: "A" }, annotations: {} };
    expect(MAX_ALERTS_PER_REQUEST).toBe(25);
    expect(parseAlertPayload({ alerts: Array(26).fill(one) })).toBeNull();
    expect(parseAlertPayload({ alerts: Array(25).fill(one) })).not.toBeNull();
  });
});
