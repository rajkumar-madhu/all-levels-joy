import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEventParser } from "@/lib/sse";
import { useSession } from "@/stores/session";
import { api } from "./client";
import { ApiError, errorMessage } from "./errors";

export type ChatThread = { id: string; title: string; created_at: string; updated_at: string };

export type SuggestedTicket = {
  title: string;
  description: string;
  category: string | null;
  subcategory: string | null;
  impact: number;
  urgency: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggested_ticket: SuggestedTicket | null;
  created_incident_id: string | null;
  created_at: string;
};

const threadsKey = (org: string) => ["orgs", org, "assistant", "threads"] as const;
const threadKey = (org: string, id: string) => ["orgs", org, "assistant", "thread", id] as const;

export function useThreads(org: string) {
  return useQuery({
    queryKey: threadsKey(org),
    queryFn: () => api<{ results: ChatThread[]; configured: boolean }>(`orgs/${org}/assistant/threads`),
  });
}

export function useThread(org: string, id: string) {
  return useQuery({
    queryKey: threadKey(org, id),
    queryFn: () =>
      api<{ thread: ChatThread; messages: ChatMessage[]; configured: boolean }>(`orgs/${org}/assistant/threads/${id}`),
  });
}

export function useCreateThread(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<ChatThread>(`orgs/${org}/assistant/threads`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: threadsKey(org) }),
  });
}

export function useDeleteThread(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`orgs/${org}/assistant/threads/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: threadsKey(org) }),
  });
}

export function useTicketFromMessage(org: string, threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<{ id: string; number: string }>(`orgs/${org}/assistant/messages/${messageId}/ticket`, { method: "POST", body: {} }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: threadKey(org, threadId) }),
        client.invalidateQueries({ queryKey: ["orgs", org, "incidents"] }),
      ]),
  });
}

/**
 * Sends a question and reads the reply as it streams (server-sent events over a POST, so it uses fetch
 * rather than EventSource). Calls `onDelta` with each text fragment and resolves with the saved message.
 */
export async function streamAssistantReply(
  org: string,
  threadId: string,
  text: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const base = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const token = useSession.getState().accessToken;
  const response = await fetch(`${base}/api/v1/orgs/${org}/assistant/threads/${threadId}/messages`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body);
    } catch {
      // keep text
    }
    throw new ApiError(errorMessage(parsed), response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = createEventParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parse(decoder.decode(value, { stream: true }))) {
      const data = event.data as { text?: string; message?: ChatMessage; detail?: string };
      if (event.event === "delta" && data.text) onDelta(data.text);
      else if (event.event === "done" && data.message) return data.message;
      else if (event.event === "error") throw new ApiError(data.detail ?? "The assistant could not answer.", 502);
    }
  }
  throw new ApiError("The answer was cut off. Try again.", 502);
}
