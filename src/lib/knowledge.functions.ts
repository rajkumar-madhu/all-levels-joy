import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

export const listKnowledgeCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("knowledge_categories")
      .select("id, name, slug, description, active, sort_order")
      .eq("organization_id", DEMO_ORG_ID)
      .order("sort_order")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveKnowledgeCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id?: string | null; name: string; description?: string; active: boolean }) =>
    z
      .object({
        id: z.string().uuid().nullish(),
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().max(200).optional(),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (data.id) {
      const { data: old } = await supabase
        .from("knowledge_categories")
        .select("name")
        .eq("id", data.id)
        .maybeSingle();
      const { error } = await supabase
        .from("knowledge_categories")
        .update({ name: data.name, slug, description: data.description ?? null, active: data.active })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      if (old && old.name !== data.name) {
        const { error: renameError } = await supabase
          .from("knowledge_articles")
          .update({ category: data.name })
          .eq("organization_id", DEMO_ORG_ID)
          .eq("category", old.name);
        if (renameError) throw new Error(renameError.message);
      }
      return { ok: true };
    }
    const { error } = await supabase.from("knowledge_categories").insert({
      organization_id: DEMO_ORG_ID,
      name: data.name,
      slug,
      description: data.description ?? null,
      active: data.active,
    });
    if (error) throw new Error(error.message.includes("duplicate") ? "That category already exists." : error.message);
    return { ok: true };
  });
