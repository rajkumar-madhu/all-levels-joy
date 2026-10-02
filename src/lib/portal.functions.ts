import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

// Customer portal: every read is scoped to records the signed-in user requested.
export const getPortal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [incidents, requests] = await Promise.all([
      supabase
        .from("incidents")
        .select(
          "id, number, title, description, state, priority, sla_due_at, resolved_at, resolution_notes, created_at, updated_at, problem_id",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .eq("requester_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("service_requests")
        .select("id, number, title, description, state, approval_status, due_at, created_at, updated_at")
        .eq("organization_id", DEMO_ORG_ID)
        .eq("requester_id", userId)
        .order("created_at", { ascending: false }),
    ]);
    if (incidents.error) throw new Error(incidents.error.message);
    if (requests.error) throw new Error(requests.error.message);
    const inc = incidents.data ?? [];
    const req = requests.data ?? [];
    const ids = [...inc.map((i) => i.id), ...req.map((r) => r.id)];

    // Linked problems and customer-facing outage updates are read with elevated
    // access but only for records already proven to belong to this user.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const problemIds = [...new Set(inc.map((i) => i.problem_id).filter(Boolean))] as string[];
    const incIds = inc.map((i) => i.id);
    const [comments, problems, majors] = await Promise.all([
      ids.length
        ? supabaseAdmin
            .from("record_comments")
            .select("id, record_type, record_id, author_id, body, created_at")
            .in("record_id", ids)
            .eq("internal", false)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      problemIds.length
        ? supabaseAdmin
            .from("problems")
            .select("id, number, title, state, known_error, workaround")
            .in("id", problemIds)
        : Promise.resolve({ data: [], error: null }),
      incIds.length
        ? supabaseAdmin
            .from("major_incidents")
            .select("id, incident_id, bridge_state")
            .in("incident_id", incIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const majorIds = (majors.data ?? []).map((m) => m.id);
    const updates = majorIds.length
      ? await supabaseAdmin
          .from("major_incident_updates")
          .select("id, major_incident_id, body, update_type, created_at")
          .in("major_incident_id", majorIds)
          .eq("audience", "customer")
          .order("created_at", { ascending: true })
      : { data: [] };

    return {
      userId,
      incidents: inc,
      requests: req,
      comments: (comments.data ?? []).map((c) => ({ ...c, mine: c.author_id === userId })),
      problems: (problems.data ?? []).map((p) => ({
        ...p,
        workaround: p.known_error ? p.workaround : null,
      })),
      outageUpdates: (updates.data ?? []).map((u) => ({
        ...u,
        incident_id: (majors.data ?? []).find((m) => m.id === u.major_incident_id)?.incident_id,
      })),
    };
  });

export const postPortalReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { recordType: "incident" | "request"; recordId: string; body: string }) =>
    z
      .object({
        recordType: z.enum(["incident", "request"]),
        recordId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const table = data.recordType === "incident" ? "incidents" : "service_requests";
    const { data: own } = await supabase
      .from(table)
      .select("id")
      .eq("id", data.recordId)
      .eq("requester_id", userId)
      .maybeSingle();
    if (!own) throw new Error("You can only reply to your own tickets.");
    const { error } = await supabase.from("record_comments").insert({
      organization_id: DEMO_ORG_ID,
      record_type: data.recordType,
      record_id: data.recordId,
      author_id: userId,
      body: data.body,
      internal: false,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
