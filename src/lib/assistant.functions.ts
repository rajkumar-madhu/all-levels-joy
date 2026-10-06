import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";
import { nextRecordNumber } from "@/lib/record-number";

const uuid = z.string().uuid();

export type SuggestedTicket = {
  title: string;
  description: string;
  category: string | null;
  subcategory: string | null;
  impact: number;
  urgency: number;
};

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggested_ticket: SuggestedTicket | null;
  created_incident_id: string | null;
  created_at: string;
};

export const listChatThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ai_chat_threads")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createChatThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ai_chat_threads")
      .insert({
        organization_id: DEMO_ORG_ID,
        user_id: userId,
        title: "New conversation",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const deleteChatThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string }) => z.object({ threadId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("ai_chat_threads")
      .delete()
      .eq("id", data.threadId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getChatThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string }) => z.object({ threadId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: thread, error: threadError } = await supabase
      .from("ai_chat_threads")
      .select("id, title, created_at")
      .eq("id", data.threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (threadError) throw new Error(threadError.message);
    if (!thread) throw new Error("Conversation not found.");

    const { data: rows, error } = await supabase
      .from("ai_chat_messages")
      .select("id, role, content, suggested_ticket, created_incident_id, created_at")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return {
      thread,
      messages: (rows ?? []) as unknown as ChatMessageRow[],
    };
  });

/** Sends the user's message to Lovable AI, persists both turns, and may propose a ticket. */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string; text: string }) =>
    z.object({ threadId: uuid, text: z.string().trim().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("The AI assistant is not configured yet.");

    const { data: thread, error: threadError } = await supabase
      .from("ai_chat_threads")
      .select("id, title")
      .eq("id", data.threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (threadError) throw new Error(threadError.message);
    if (!thread) throw new Error("Conversation not found.");

    const { data: history } = await supabase
      .from("ai_chat_messages")
      .select("role, content")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true })
      .limit(40);

    const { error: userInsertError } = await supabase.from("ai_chat_messages").insert({
      thread_id: data.threadId,
      organization_id: DEMO_ORG_ID,
      user_id: userId,
      role: "user",
      content: data.text,
    });
    if (userInsertError) throw new Error(userInsertError.message);

    const { data: articles } = await supabase
      .from("knowledge_articles")
      .select("id, number, title, summary, content, category, tags, updated_at")
      .eq("organization_id", DEMO_ORG_ID)
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(300);

    // Rank published staff articles by overlap with the question so the most
    // relevant real content grounds the answer.
    const terms = data.text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2);
    const ranked = (articles ?? [])
      .map((article) => {
        const title = article.title.toLowerCase();
        const category = article.category.toLowerCase();
        const tags = (article.tags ?? []).map((tag) => tag.toLowerCase());
        const body = `${article.summary ?? ""} ${article.content ?? ""}`.toLowerCase();
        const score = terms.reduce(
          (sum, term) =>
            sum +
            (title.includes(term) ? 3 : 0) +
            (tags.some((tag) => tag === term || tag.split("-").includes(term)) ? 4 : 0) +
            (category.includes(term) ? 2 : 0) +
            (body.includes(term) ? 1 : 0),
          0,
        );
        return { article, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const knowledge = ranked
      .map(
        ({ article }) =>
          `${article.number} — ${article.title}\nCategory: ${article.category}\nTags: ${(article.tags ?? []).join(", ") || "none"}\nLink: [${article.number}](/knowledge?record=${article.id})\n${article.summary ?? ""}\n${(article.content ?? "").slice(0, 2500)}`,
      )
      .join("\n\n---\n\n");

    const { data: catalogItems } = await supabase
      .from("catalog_items")
      .select("id, name, category, description")
      .eq("organization_id", DEMO_ORG_ID)
      .eq("active", true)
      .limit(60);
    const catalogText = (catalogItems ?? [])
      .map((item) => `- ${item.name} [${item.category}]: ${item.description ?? ""} → [Request ${item.name}](/catalog?item=${item.id})`)
      .join("\n");

    const { streamText, Output, NoObjectGeneratedError } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { createLovableAiGatewayRunIdFetch } = await import("@/lib/ai-gateway.server");

    const runIdFetch = createLovableAiGatewayRunIdFetch();
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch as unknown as typeof fetch,
    });

    const system = [
      "You are the WeCrew IT service desk assistant for an internal ITSM workspace.",
      "Help employees troubleshoot common IT issues (VPN, Wi-Fi, email, printing, laptops, passwords, access requests, SaaS apps) with short, practical, numbered steps.",
      "Answer from the staff-written knowledge base articles below first. Follow their steps faithfully, cite each article you used with its markdown link exactly as given (e.g. [KB001094](/knowledge?record=...)), and do not invent policies that contradict them. If no article covers the issue, say plainly that there is no knowledge article for it yet, give brief general guidance, and offer to raise a ticket.",
      "If the issue is already resolved by a simple step, do not propose a ticket.",
      "Propose a ticket (needsTicket true) when the problem is not self-serviceable, is urgent, affects multiple people, or the user asks to log it. Never claim a ticket was created — the user must confirm it.",
      "Impact and urgency are 1 (high), 2 (medium) or 3 (low). Category must be one of network, hardware, software, database, inquiry.",
      "Keep replies under 200 words and use markdown.",
      "When the user needs something new (access, software, hardware, accounts) rather than fixing something broken, point them to the matching service catalogue item using its markdown link instead of proposing an incident. For broken things they can also self-report at [Report an issue](/catalog).",
      catalogText ? `Service catalogue:\n${catalogText}` : "Service catalogue: (empty)",
      knowledge ? `Knowledge base:\n${knowledge}` : "Knowledge base: (none published yet)",
    ].join("\n\n");

    const messages = [
      ...(history ?? []).map((row) => ({
        role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: row.content,
      })),
      { role: "user" as const, content: data.text },
    ];

    const schema = z.object({
      reply: z.string(),
      needsTicket: z.boolean(),
      ticketTitle: z.string().nullable(),
      ticketDescription: z.string().nullable(),
      ticketCategory: z.string().nullable(),
      ticketSubcategory: z.string().nullable(),
      ticketImpact: z.number().nullable(),
      ticketUrgency: z.number().nullable(),
    });

    let parsed: z.infer<typeof schema> | null = null;
    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system,
        messages,
        output: Output.object({ schema }),
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      parsed = (await result.output) as z.infer<typeof schema>;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const text = error.text ?? "";
        parsed = {
          reply: text.trim() || "I could not generate an answer. Please try rephrasing.",
          needsTicket: false,
          ticketTitle: null,
          ticketDescription: null,
          ticketCategory: null,
          ticketSubcategory: null,
          ticketImpact: null,
          ticketUrgency: null,
        };
      } else {
        throw error;
      }
    }

    const clamp = (value: number | null) => {
      const rounded = Math.round(value ?? 3);
      return rounded < 1 ? 1 : rounded > 3 ? 3 : rounded;
    };
    const allowedCategories = ["network", "hardware", "software", "database", "inquiry"];

    const suggested: SuggestedTicket | null =
      parsed && parsed.needsTicket
        ? {
            title: (parsed.ticketTitle ?? data.text).slice(0, 160),
            description: (parsed.ticketDescription ?? data.text).slice(0, 4000),
            category: allowedCategories.includes(parsed.ticketCategory ?? "")
              ? parsed.ticketCategory
              : null,
            subcategory: parsed.ticketSubcategory?.slice(0, 60) ?? null,
            impact: clamp(parsed.ticketImpact),
            urgency: clamp(parsed.ticketUrgency),
          }
        : null;

    const { data: assistantRow, error: assistantError } = await supabase
      .from("ai_chat_messages")
      .insert({
        thread_id: data.threadId,
        organization_id: DEMO_ORG_ID,
        user_id: userId,
        role: "assistant",
        content: linkKnowledgeCitations(parsed?.reply ?? "", ranked.map(({ article }) => article)),
        suggested_ticket: suggested,
      })
      .select("id")
      .single();
    if (assistantError) throw new Error(assistantError.message);

    const title = thread.title === "New conversation" ? data.text.slice(0, 60) : thread.title;
    await supabase
      .from("ai_chat_threads")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", data.threadId)
      .eq("user_id", userId);

    return { messageId: assistantRow.id };
  });

/** Creates the incident the assistant proposed, after the user confirms it. */
export const createTicketFromChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { messageId: string }) => z.object({ messageId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: message, error } = await supabase
      .from("ai_chat_messages")
      .select("id, thread_id, suggested_ticket, created_incident_id")
      .eq("id", data.messageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!message) throw new Error("Message not found.");
    if (message.created_incident_id) throw new Error("A ticket was already created.");

    const suggestion = message.suggested_ticket as SuggestedTicket | null;
    if (!suggestion) throw new Error("There is no ticket proposal on this message.");

    const { data: created, error: insertError } = await supabase.rpc("itsm_self_service_incident", {
      _org_id: DEMO_ORG_ID,
      _title: suggestion.title,
      _description: suggestion.description,
      _impact: suggestion.impact,
      _urgency: suggestion.urgency,
      _category: suggestion.category ?? "",
      _subcategory: suggestion.subcategory ?? "",
      _contact_type: "chat",
    });
    if (insertError) throw new Error(insertError.message);
    const incident = created as { id: string; number: string };

    await supabase
      .from("ai_chat_messages")
      .update({ created_incident_id: incident.id })
      .eq("id", message.id)
      .eq("user_id", userId);

    return incident;
  });

// Turn plain article numbers the model cites into links to the article, without
// touching numbers that are already inside a markdown link.
function linkKnowledgeCitations(text: string, articles: { id: string; number: string }[]) {
  let result = text;
  for (const article of articles) {
    const pattern = new RegExp(`(?<![\\[/=])\\b${article.number}\\b(?!\\]\\()`, "g");
    result = result.replace(pattern, `[${article.number}](/knowledge?record=${article.id})`);
  }
  return result;
}
