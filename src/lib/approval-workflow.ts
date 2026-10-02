import { z } from "zod";

const uuid = z.string().uuid();
const plan = z.string().trim().min(5).max(6000);

export const serviceRequestInputSchema = z.object({
  catalogItemId: uuid,
  title: z.string().trim().min(5).max(160),
  description: plan,
});

export const changeInputSchema = z
  .object({
    title: z.string().trim().min(5).max(160),
    description: plan,
    changeType: z.enum(["standard", "normal", "emergency"]),
    risk: z.enum(["low", "medium", "high", "critical"]),
    serviceId: uuid.nullish(),
    ownerId: uuid.nullish(),
    implementationPlan: plan,
    testPlan: plan,
    rollbackPlan: plan,
    businessJustification: plan,
    impactAssessment: plan,
    expectedOutageMinutes: z.number().int().min(0).max(10080),
    affectedCiIds: z.array(uuid).max(100),
    validationPlan: plan,
    rollbackTrigger: plan,
    communicationPlan: plan,
    startAt: z.string().min(1),
    endAt: z.string().min(1),
  })
  .superRefine((data, context) => {
    const start = Date.parse(data.startAt);
    const end = Date.parse(data.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "The change window must end after it starts.",
      });
    }
  });

export const approvalDecisionSchema = z
  .object({
    id: uuid,
    decision: z.enum(["approved", "rejected"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, context) => {
    if (data.decision === "rejected" && !data.notes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "Decision notes are required when rejecting a record.",
      });
    }
  });

export const createdApprovalSubjectSchema = z.object({
  id: uuid,
  number: z.string().min(1),
  groupName: z.string().nullish(),
  dueAt: z.string().nullish(),
  priority: z.number().nullish(),
});
export type ChangeInput = Omit<z.input<typeof changeInputSchema>, "changeType" | "risk"> & {
  changeType: string;
  risk: string;
};
