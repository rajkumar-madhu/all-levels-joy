import { describe, expect, test } from "bun:test";
import {
  approvalDecisionSchema,
  changeInputSchema,
  serviceRequestInputSchema,
} from "../src/lib/approval-workflow";

const id = "10000000-0000-4000-8000-000000000001";
const proposal = {
  title: "Upgrade gateway",
  description: "Upgrade the production gateway",
  changeType: "normal",
  risk: "medium",
  implementationPlan: "Upgrade one node at a time",
  testPlan: "Run health checks",
  rollbackPlan: "Restore the original image",
  businessJustification: "Improve gateway reliability",
  impactAssessment: "One node unavailable at a time",
  expectedOutageMinutes: 0,
  affectedCiIds: [id],
  validationPlan: "Verify customer traffic",
  rollbackTrigger: "Error rate increases",
  communicationPlan: "Notify affected service owners",
  startAt: "2026-09-28T01:00:00Z",
  endAt: "2026-09-28T02:00:00Z",
};

describe("approval submission boundary", () => {
  test("rejects blank or oversized requests before a database write", () => {
    expect(
      serviceRequestInputSchema.safeParse({
        catalogItemId: id,
        title: "     ",
        description: "Useful details",
      }).success,
    ).toBe(false);
    expect(
      serviceRequestInputSchema.safeParse({
        catalogItemId: id,
        title: "Laptop request",
        description: "x".repeat(6001),
      }).success,
    ).toBe(false);
  });
  test("requires decision evidence for every rejected request or change", () => {
    expect(
      approvalDecisionSchema.safeParse({ id, decision: "rejected", notes: "  " }).success,
    ).toBe(false);
    expect(
      approvalDecisionSchema.parse({ id, decision: "rejected", notes: "  Budget is unavailable  " })
        .notes,
    ).toBe("Budget is unavailable");
    expect(approvalDecisionSchema.safeParse({ id, decision: "approved" }).success).toBe(true);
  });
  test("rejects invalid, reversed and zero-length change windows", () => {
    for (const endAt of ["invalid", proposal.startAt, "2026-09-27T01:00:00Z"]) {
      expect(changeInputSchema.safeParse({ ...proposal, endAt }).success).toBe(false);
    }
    expect(changeInputSchema.safeParse(proposal).success).toBe(true);
  });
  test("requires complete evidence and bounded impact", () => {
    expect(changeInputSchema.safeParse({ ...proposal, rollbackPlan: "  " }).success).toBe(false);
    expect(changeInputSchema.safeParse({ ...proposal, expectedOutageMinutes: 0.5 }).success).toBe(
      false,
    );
    expect(
      changeInputSchema.safeParse({ ...proposal, affectedCiIds: Array(101).fill(id) }).success,
    ).toBe(false);
  });
});
