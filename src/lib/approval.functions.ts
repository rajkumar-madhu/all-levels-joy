import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";
import {
  approvalDecisionSchema,
  changeInputSchema,
  createdApprovalSubjectSchema,
  serviceRequestInputSchema,
  type ChangeInput,
} from "@/lib/approval-workflow";

export const createServiceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { catalogItemId: string; title: string; description: string }) =>
    serviceRequestInputSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("itsm_create_service_request", {
      _org_id: DEMO_ORG_ID,
      _catalog_item_id: data.catalogItemId,
      _title: data.title,
      _description: data.description,
    });
    if (error) throw new Error(error.message);
    return createdApprovalSubjectSchema.parse(result);
  });

export const createChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: ChangeInput) => changeInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("itsm_create_change", {
      _org_id: DEMO_ORG_ID,
      _input: {
        ...data,
        startAt: new Date(data.startAt).toISOString(),
        endAt: new Date(data.endAt).toISOString(),
      },
    });
    if (error) throw new Error(error.message);
    return createdApprovalSubjectSchema.parse(result);
  });

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; decision: "approved" | "rejected"; notes?: string }) =>
    approvalDecisionSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("itsm_decide_approval", {
      _approval_id: data.id,
      _decision: data.decision,
      _notes: data.notes ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
