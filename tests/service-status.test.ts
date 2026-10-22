import { describe, expect, test } from "bun:test";
import { overallServiceState, serviceState, visibleServices } from "../src/lib/service-status";

describe("public service status", () => {
  test("VPN, payments and ERP remain unknown without a service record", () => {
    expect(visibleServices([])).toEqual([
      { name: "ERP", status: "unknown", updated_at: null },
      { name: "Payments", status: "unknown", updated_at: null },
      { name: "VPN", status: "unknown", updated_at: null },
    ]);
  });
  test("uses recorded VPN status without duplicating it", () => {
    const services = visibleServices([{ name: "Corporate VPN", status: "outage", updated_at: "2026-10-22T01:00:00Z" }]);
    expect(services.filter((s) => s.name.includes("VPN"))).toEqual([{ name: "Corporate VPN", status: "outage", updated_at: "2026-10-22T01:00:00Z" }]);
  });
  test("unrecognized and empty statuses never imply healthy service", () => {
    expect(serviceState("unverified")).toBe("unknown");
    expect(overallServiceState([])).toBe("unknown");
    expect(overallServiceState([{ name: "ERP", status: "unknown", updated_at: null }])).toBe("unknown");
  });
  test("outages take priority over degraded and healthy service", () => {
    expect(overallServiceState([
      { name: "VPN", status: "operational", updated_at: null },
      { name: "Payments", status: "degraded", updated_at: null },
      { name: "ERP", status: "outage", updated_at: null },
    ])).toBe("outage");
  });
});