import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { api } from "./client";
import type {
  Article,
  ArticleSummary,
  Incident,
  IncidentSummary,
  Me,
  NewIncident,
  SecurityBoard,
  Severity,
  Transition,
  Workspace,
} from "./types";

export const keys = {
  me: ["me"] as const,
  incidents: (org: string, filters: object) => ["orgs", org, "incidents", filters] as const,
  incident: (org: string, id: string) => ["orgs", org, "incident", id] as const,
  articles: (org: string, q: string) => ["orgs", org, "knowledge", q] as const,
  article: (org: string, id: string) => ["orgs", org, "article", id] as const,
  security: (org: string) => ["orgs", org, "security"] as const,
};

export function useMe() {
  const signedIn = useSession((s) => s.status === "signed-in");
  return useQuery({ queryKey: keys.me, queryFn: () => api<Me>("me"), enabled: signedIn, staleTime: 60_000 });
}

/** The workspace in use: the remembered choice if the user still belongs to it, else the first one. */
export function useActiveWorkspace(): Workspace | null {
  const { data } = useMe();
  const activeOrgId = useSession((s) => s.activeOrgId);
  if (!data?.workspaces.length) return null;
  return data.workspaces.find((w) => w.id === activeOrgId) ?? data.workspaces[0] ?? null;
}

export function useIncidents(org: string, filters: { state?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.q) params.set("q", filters.q);
  return useQuery({
    queryKey: keys.incidents(org, filters),
    queryFn: () => api<{ results: IncidentSummary[] }>(`orgs/${org}/incidents?${params}`).then((r) => r.results),
  });
}

export function useIncident(org: string, id: string) {
  return useQuery({ queryKey: keys.incident(org, id), queryFn: () => api<Incident>(`orgs/${org}/incidents/${id}`) });
}

export function useCreateIncident(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NewIncident) =>
      api<{ id: string; number: string }>(`orgs/${org}/incidents`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["orgs", org, "incidents"] }),
  });
}

export function useArticles(org: string, q: string) {
  const params = new URLSearchParams(q ? { q } : {});
  return useQuery({
    queryKey: keys.articles(org, q),
    queryFn: () => api<{ results: ArticleSummary[] }>(`orgs/${org}/knowledge?${params}`).then((r) => r.results),
  });
}

export function useArticle(org: string, id: string) {
  return useQuery({ queryKey: keys.article(org, id), queryFn: () => api<Article>(`orgs/${org}/knowledge/${id}`) });
}

export function useSecurityBoard(org: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.security(org),
    queryFn: () => api<SecurityBoard>(`orgs/${org}/security/board`),
    enabled,
  });
}

function useSecurityMutation<TVars>(org: string, request: (vars: TVars) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.security(org) }),
  });
}

export function useCreateFinding(org: string) {
  return useSecurityMutation(
    org,
    (body: { title: string; description: string; severity: Severity; reference?: string }) =>
      api<{ id: string; number: string }>(`orgs/${org}/security/findings`, { method: "POST", body }),
  );
}

export function useTransitionFinding(org: string) {
  return useSecurityMutation(org, ({ id, step }: { id: string; step: Transition }) =>
    api(`orgs/${org}/security/findings/${id}/transition`, { method: "POST", body: step }),
  );
}

export function useRequestException(org: string) {
  return useSecurityMutation(
    org,
    ({ findingId, ...body }: { findingId: string; justification: string; compensatingControls: string; expiresAt: string }) =>
      api(`orgs/${org}/security/findings/${findingId}/exceptions`, { method: "POST", body }),
  );
}

export function useDecideException(org: string) {
  return useSecurityMutation(
    org,
    ({ id, ...body }: { id: string; decision: "approved" | "rejected"; notes?: string }) =>
      api(`orgs/${org}/security/exceptions/${id}/decision`, { method: "POST", body }),
  );
}
