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
    return {
      links: links.data ?? [],
      incidents: incidents.data ?? [],
      problems: problems.data ?? [],
    };
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

export const getIncidentLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { incidentId: string }) => z.object({ incidentId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [links, incident] = await Promise.all([
      supabase
        .from("change_links")
        .select("id, relation, change_id")
        .eq("record_type", "incident")
        .eq("record_id", data.incidentId),
      supabase.from("incidents").select("problem_id").eq("id", data.incidentId).maybeSingle(),
    ]);
    if (links.error) throw new Error(links.error.message);
    if (incident.error) throw new Error(incident.error.message);
    const changeIds = (links.data ?? []).map((l) => l.change_id);
    const changes = changeIds.length
      ? await supabase.from("changes").select("id, number, title, state, risk").in("id", changeIds)
      : { data: [], error: null };
    if (changes.error) throw new Error(changes.error.message);
    let problem: { id: string; number: string; title: string; state: string } | null = null;
    if (incident.data?.problem_id) {
      const p = await supabase
        .from("problems")
        .select("id, number, title, state")
        .eq("id", incident.data.problem_id)
        .maybeSingle();
      if (p.error) throw new Error(p.error.message);
      problem = p.data;
    }
    return {
      changes: (links.data ?? []).flatMap((l) => {
        const c = changes.data?.find((x) => x.id === l.change_id);
        return c ? [{ ...c, relation: l.relation, linkId: l.id }] : [];
      }),
      problem,
    };
  });
