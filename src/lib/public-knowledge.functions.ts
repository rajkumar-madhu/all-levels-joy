import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

// Public, unauthenticated read of published knowledge articles for the
// customer portal. Uses the publishable key as anon; RLS only exposes
// published articles and active categories.

function publicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const shim: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { fetch: shim },
  });
}

export const searchPublicKnowledge = createServerFn({ method: "GET" })
  .inputValidator((input: { query?: string; category?: string }) =>
    z
      .object({
        query: z.string().trim().max(120).optional(),
        category: z.string().trim().max(60).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const [categories, articles] = await Promise.all([
      supabase
        .from("knowledge_categories")
        .select("id, name, description, sort_order")
        .eq("organization_id", DEMO_ORG_ID)
        .eq("active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("knowledge_articles")
        .select("id, number, title, summary, category, tags, published_at")
        .eq("organization_id", DEMO_ORG_ID)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(200),
    ]);
    if (categories.error) throw new Error(categories.error.message);
    if (articles.error) throw new Error(articles.error.message);

    const q = (data.query ?? "").toLowerCase();
    const filtered = (articles.data ?? []).filter((a) => {
      if (data.category && a.category !== data.category) return false;
      if (!q) return true;
      const hay = [a.title, a.summary ?? "", a.category, ...(a.tags ?? [])].join(" ").toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
    return { categories: categories.data ?? [], articles: filtered.slice(0, 50) };
  });

export const getPublicKnowledgeArticle = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const { data: article, error } = await supabase
      .from("knowledge_articles")
      .select("id, number, title, summary, content, category, tags, published_at")
      .eq("organization_id", DEMO_ORG_ID)
      .eq("id", data.id)
      .eq("status", "published")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return article;
  });
