import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";
import { requireSecurityStaff } from "@/lib/security-access";
import {
  exceptionInputSchema,
  findingInputSchema,
  transitionSchema,
  type TransitionInput,
} from "@/lib/security-workflow";

export const getSecurityBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await requireSecurityStaff(() => supabase.rpc("can_manage", { _org_id: DEMO_ORG_ID }));
    const [findings, exceptions, changes, incidents] = await Promise.all([
      supabase
        .from("security_findings")
        .select("*")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("security_exceptions")
        .select("*")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("changes")
        .select("id, number, title")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("incidents")
        .select("id, number, title")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    for (const r of [findings, exceptions, changes, incidents])
      if (r.error) throw new Error(r.error.message);
    return {
      findings: findings.data ?? [],
      exceptions: exceptions.data ?? [],
      changes: changes.data ?? [],
      incidents: incidents.data ?? [],
    };
  });

export const getScannerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: allowed, error } = await context.supabase.rpc("can_manage", {
      _org_id: DEMO_ORG_ID,
    });
    if (error || !allowed) throw new Error("Only workspace staff can access scanner connections.");
    return { configured: Boolean(process.env["SECURITY_SCANNER_SECRET"]) };
  });

export const createSecurityFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof findingInputSchema>) => findingInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("itsm_create_security_finding", {
      _org_id: DEMO_ORG_ID,
      _input: data,
    });
    if (error) throw new Error(error.message);
    return result as { id: string; number: string };
  });

export const transitionSecurityFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; step: TransitionInput }) =>
    z.object({ id: z.string().uuid(), step: transitionSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { action, ...rest } = data.step;
    const payload: Record<string, unknown> = { ...rest };
    const { error } = await context.supabase.rpc("itsm_transition_security_finding", {
      _finding_id: data.id,
      _action: action as string,
      _input: payload as never,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const requestSecurityException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof exceptionInputSchema>) => exceptionInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("itsm_request_security_exception", {
      _finding_id: data.findingId,
      _justification: data.justification,
      _controls: data.compensatingControls,
      _expires_at: new Date(data.expiresAt).toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const decideSecurityException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; decision: "approved" | "rejected"; notes?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        notes: z.string().trim().max(2000).optional(),
      })
      .refine((d) => d.decision === "approved" || !!d.notes, {
        message: "Decision notes are required when rejecting.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("itsm_decide_security_exception", {
      _exception_id: data.id,
      _decision: data.decision,
      _notes: data.notes ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
