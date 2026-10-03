import { z } from "zod";

const plan = z.string().trim().min(5).max(6000);

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const SECURITY_STATES = [
  "requested",
  "pending_approval",
  "scheduled",
  "remediating",
  "delivered",
  "closed",
  "cancelled",
  "risk_accepted",
] as const;
export const SEVERITY_DAYS: Record<(typeof SEVERITIES)[number], number> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
};

export const findingInputSchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().max(6000).default(""),
  reference: z.string().trim().max(120).optional(),
  severity: z.enum(SEVERITIES),
  serviceId: z.string().uuid().nullish(),
});

export const transitionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"),
    impactAssessment: plan,
    fixPlan: plan,
    testPlan: plan,
    rollbackPlan: plan,
    rollbackTrigger: plan,
  }),
  z.object({ action: z.literal("approve"), notes: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("reject"), notes: z.string().trim().min(1).max(2000) }),
  z.object({
    action: z.literal("schedule"),
    windowStart: z.string().min(1, "Choose a window start."),
    windowEnd: z.string().min(1, "Choose a window end."),
  }),
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("deliver"),
    outcome: z.enum(["successful", "partial", "failed"]),
    validationResults: plan,
    reviewNotes: plan,
    rollbackUsed: z.boolean(),
  }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("link"),
    changeId: z.string().uuid().or(z.literal("")).optional(),
    incidentId: z.string().uuid().or(z.literal("")).optional(),
  }),
]);
export type TransitionInput = z.input<typeof transitionSchema>;

export const exceptionInputSchema = z
  .object({
    findingId: z.string().uuid(),
    justification: z.string().trim().min(10).max(4000),
    compensatingControls: z.string().trim().min(10).max(4000),
    expiresAt: z.string(),
  })
  .refine(
    (d) => {
      const t = Date.parse(d.expiresAt);
      return Number.isFinite(t) && t > Date.now() && t <= Date.now() + 366 * 86_400_000;
    },
    { message: "Expiry must be within the next year.", path: ["expiresAt"] },
  );

export const scannerFindingSchema = z.object({
  scanner: z.string().trim().min(1).max(80),
  reference: z.string().trim().min(1).max(120),
  title: z.string().trim().min(3).max(160),
  description: z.string().max(6000).optional(),
  severity: z.enum(SEVERITIES),
  asset: z.string().trim().max(200).optional(),
});
export const scannerPayloadSchema = z.object({
  findings: z.array(scannerFindingSchema).min(1).max(100),
});
