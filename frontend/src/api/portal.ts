import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { api } from "./client";
import { ApiError, errorMessage } from "./errors";
import type { IncidentState } from "./types";

export type PortalIncident = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  state: IncidentState;
  priority: number | null;
  sla_due_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  problem_id: string | null;
  on_hold_reason: string | null;
};

export type PortalRequest = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  state: IncidentState;
  approval_status: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  awaiting_customer_since: string | null;
};

export type PortalComment = { id: string; record_type: "incident" | "request"; record_id: string; body: string; created_at: string; mine: boolean };

export type Portal =
  | { allowed: false }
  | {
      allowed: true;
      incidents: PortalIncident[];
      requests: PortalRequest[];
      comments: PortalComment[];
      problems: { id: string; number: string; title: string; state: string; known_error: boolean; workaround: string | null }[];
      outageUpdates: { id: string; incident_id: string; body: string; update_type: string; created_at: string }[];
    };

export type PublicArticleSummary = {
  id: string;
  number: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  published_at: string | null;
};
export type PublicArticle = PublicArticleSummary & { content: string | null };
export type PublicCategory = { id: string; name: string; description: string | null };

const portalKey = ["portal"] as const;

export function usePortal() {
  const signedIn = useSession((s) => s.status === "signed-in");
  return useQuery({ queryKey: portalKey, queryFn: () => api<Portal>("portal"), enabled: signedIn });
}

export function useSubmitPortalTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description: string; impact: number; urgency: number; category: string | null }) =>
      api<{ id: string; number: string }>("portal/tickets", { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: portalKey }),
  });
}

export function usePortalReply() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ recordType, recordId, body }: { recordType: "incident" | "request"; recordId: string; body: string }) =>
      api<{ ok: true; outcome: "comment" | "resumed" | "reopened" | "closed" }>(`portal/${recordType}s/${recordId}/replies`, {
        method: "POST",
        body: { body },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: portalKey }),
  });
}

/** Anonymous reads: no token is sent and a 401 never triggers sign-in. */
async function publicGet<T>(path: string): Promise<T> {
  const base = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const response = await fetch(`${base}/api/public/${path}`, { headers: { Accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(errorMessage(body), response.status);
  return body as T;
}

export function usePublicKnowledge(query: string, category: string) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (category) params.set("category", category);
  return useQuery({
    queryKey: ["public-knowledge", query, category],
    queryFn: () => publicGet<{ categories: PublicCategory[]; articles: PublicArticleSummary[] }>(`knowledge?${params}`),
  });
}

export function usePublicArticle(id: string) {
  return useQuery({ queryKey: ["public-article", id], queryFn: () => publicGet<PublicArticle>(`knowledge/${id}`) });
}
