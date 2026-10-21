import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { api } from "./client";
import type {
  Article,
  CatalogItem,
  Change,
  ChangeAction,
  ChangeSummary,
  MyApproval,
  NewChange,
  RecordState,
  ServiceRequest,
  ServiceRequestSummary,
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
  catalog: (org: string) => ["orgs", org, "catalog"] as const,
  requests: (org: string) => ["orgs", org, "requests"] as const,
  changes: (org: string) => ["orgs", org, "changes"] as const,
  approvals: (org: string) => ["orgs", org, "approvals"] as const,
};

function listParams(filters: { state?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.q) params.set("q", filters.q);
  return params;
}

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

export function useCatalog(org: string) {
  return useQuery({
    queryKey: keys.catalog(org),
    queryFn: () => api<{ results: CatalogItem[] }>(`orgs/${org}/catalog`).then((r) => r.results),
    staleTime: 60_000,
  });
}

export function useRequests(org: string, filters: { state?: string; q?: string }) {
  return useQuery({
    queryKey: [...keys.requests(org), filters],
    queryFn: () =>
      api<{ results: ServiceRequestSummary[] }>(`orgs/${org}/requests?${listParams(filters)}`).then((r) => r.results),
  });
}

export function useServiceRequest(org: string, id: string) {
  return useQuery({ queryKey: [...keys.requests(org), id], queryFn: () => api<ServiceRequest>(`orgs/${org}/requests/${id}`) });
}

export function useCreateRequest(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { catalogItemId: string; title: string; description: string }) =>
      api<{ id: string; number: string; dueAt: string | null }>(`orgs/${org}/requests`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.requests(org) }),
  });
}

export function useUpdateRequest(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; state: RecordState; expectedUpdatedAt: string; awaitingCustomer?: boolean }) =>
      api<ServiceRequest>(`orgs/${org}/requests/${id}`, { method: "PATCH", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.requests(org) }),
  });
}

export function useChanges(org: string, filters: { state?: string; q?: string }) {
  return useQuery({
    queryKey: [...keys.changes(org), filters],
    queryFn: () => api<{ results: ChangeSummary[] }>(`orgs/${org}/changes?${listParams(filters)}`).then((r) => r.results),
  });
}

export function useChange(org: string, id: string) {
  return useQuery({ queryKey: [...keys.changes(org), id], queryFn: () => api<Change>(`orgs/${org}/changes/${id}`) });
}

export function useCreateChange(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NewChange) => api<{ id: string; number: string }>(`orgs/${org}/changes`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.changes(org) }),
  });
}

export function useChangeAction(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, step }: { id: string; step: ChangeAction }) =>
      api<Change>(`orgs/${org}/changes/${id}/actions`, { method: "POST", body: step }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.changes(org) }),
  });
}

export function useMyApprovals(org: string, status: string) {
  return useQuery({
    queryKey: [...keys.approvals(org), status],
    queryFn: () => api<{ results: MyApproval[] }>(`orgs/${org}/approvals?status=${status}`).then((r) => r.results),
  });
}

export function useDecideApproval(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; decision: "approved" | "rejected"; notes?: string }) =>
      api(`orgs/${org}/approvals/${id}/decision`, { method: "POST", body }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.approvals(org) }),
        client.invalidateQueries({ queryKey: keys.requests(org) }),
        client.invalidateQueries({ queryKey: keys.changes(org) }),
      ]),
  });
}
