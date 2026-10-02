import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

const uuid = z.string().uuid();

export const listRequestTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { requestId: string }) => z.object({ requestId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("request_tasks")
      .select("id, title, state, due_at, assignee_id, created_at, updated_at")
      .eq("request_id", data.requestId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addRequestTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { requestId: string; title: string; dueAt?: string }) =>
    z
      .object({
        requestId: uuid,
        title: z.string().trim().min(3).max(160),
        dueAt: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: request } = await context.supabase
      .from("service_requests")
      .select("approval_status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!request) throw new Error("Request not found.");
    if (!["approved", "not_required"].includes(request.approval_status))
      throw new Error("Fulfillment tasks can be added once the request is approved.");
    const { error } = await context.supabase.from("request_tasks").insert({
      organization_id: DEMO_ORG_ID,
      request_id: data.requestId,
      title: data.title,
      state: "open",
      assignee_id: context.userId,
      due_at: data.dueAt ? new Date(data.dueAt).toISOString() : null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setRequestTaskState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; state: "open" | "in_progress" | "closed" | "cancelled" }) =>
    z
      .object({ id: uuid, state: z.enum(["open", "in_progress", "closed", "cancelled"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("request_tasks")
      .update({ state: data.state })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
