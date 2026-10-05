import { describe, expect, test } from "bun:test";
import {
  exceptionInputSchema,
  scannerPayloadSchema,
  transitionSchema,
} from "../src/lib/security-workflow";

const id = "10000000-0000-4000-8000-000000000001";

describe("security finding boundaries", () => {
  test("submission requires every plan", () => {
    const base = {
      action: "submit",
      impactAssessment: "Short blip",
      fixPlan: "Patch package",
      testPlan: "Run checks",
      rollbackPlan: "Reinstall",
      rollbackTrigger: "Errors rise",
    };
    expect(transitionSchema.safeParse(base).success).toBe(true);
    expect(transitionSchema.safeParse({ ...base, rollbackPlan: " " }).success).toBe(false);
  });
  test("rejection needs notes", () => {
    expect(transitionSchema.safeParse({ action: "reject", notes: "" }).success).toBe(false);
  });
  test("exceptions expire within a year", () => {
    const ok = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const late = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const input = { findingId: id, justification: "Vendor fix pending", compensatingControls: "WAF rule in place" };
    expect(exceptionInputSchema.safeParse({ ...input, expiresAt: ok }).success).toBe(true);
    expect(exceptionInputSchema.safeParse({ ...input, expiresAt: late }).success).toBe(false);
  });
  test("scanner payload is bounded", () => {
    const f = { scanner: "trivy", reference: "CVE-1", title: "Bad lib", severity: "high" };
    expect(scannerPayloadSchema.safeParse({ findings: [f] }).success).toBe(true);
    expect(scannerPayloadSchema.safeParse({ findings: [] }).success).toBe(false);
    expect(scannerPayloadSchema.safeParse({ findings: [{ ...f, severity: "urgent" }] }).success).toBe(false);
  });
});
