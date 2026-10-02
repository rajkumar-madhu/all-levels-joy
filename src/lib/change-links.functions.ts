import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

const uuid = z.string().uuid();

export const getChangeLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { changeId: string }) => z.object({ changeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [links, incidents, problems] = await Promise.all([
      supabase.from("change_links").select("*").eq("change_id", data.changeId),
      supabase
        .from("incidents")
        .select("id, number, title, state")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("problems")
        .select("id, number, title, state")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    for (const r of [links, incidents, problems]) if (r.error) throw new Error(r.error.message);
    return { links: links.data ?? [], incidents: incidents.data ?? [], problems: problems.data ?? [] };
  });

export const setChangeLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      changeId: string;
      recordType: "incident" | "problem";
      recordId: string;
      relation?: string;
      linked: boolean;
    }) =>
      z
        .object({
          changeId: uuid,
          recordType: z.enum(["incident", "problem"]),
          recordId: uuid,
          relation: z.enum(["resolves", "caused_by", "related"]).default("resolves"),
          linked: z.boolean(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.linked) {
      const { error } = await supabase.from("change_links").insert({
        organization_id: DEMO_ORG_ID,
        change_id: data.changeId,
        record_type: data.recordType,
        record_id: data.recordId,
        relation: data.relation,
        linked_by: userId,
      });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("change_links")
        .delete()
        .eq("change_id", data.changeId)
        .eq("record_type", data.recordType)
        .eq("record_id", data.recordId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
