// Assets & CMDB, catalogue administration, request tasks, change links, operator-raised incidents and the
// incident work queues.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { IncidentSummary, RecordState } from "./types";

export type Service = { id: string; name: string; code: string | null; status: string; criticality: string };

export type CiStatus = "operational" | "degraded" | "maintenance" | "retired";
export type Criticality = "low" | "medium" | "high" | "critical";

export type CiRelationship = {
  id: string;
  relationship_type: string;
  parent_id: string;
  parent_name: string;
  child_id: string;
  child_name: string;
};

export type Asset = {
  id: string;
  name: string;
  ci_class: string;
  asset_tag: string | null;
  environment: string | null;
  status: CiStatus;
  criticality: Criticality;
  location: string | null;
  ip_address: string | null;
  service_id: string | null;
  service_name: string | null;
  owner_name: string | null;
  updated_at: string;
  relationship_count?: number;
  relationships?: CiRelationship[];
};

export type AssetInput = {
  name: string;
  ciClass: string;
  environment: string;
  status: CiStatus;
  criticality: Criticality;
  location: string;
  serviceId: string | null;
};

export type CatalogAdminItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  delivery_days: number;
  approval_required: boolean;
  active: boolean;
  default_priority: number | null;
  default_group_id: string | null;
  group_name: string | null;
  updated_at: string;
};

export type TaskState = "open" | "in_progress" | "closed" | "cancelled";
export type RequestTask = {
  id: string;
  title: string;
  state: TaskState | RecordState;
  due_at: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeLink = {
  id: string;
  record_type: "incident" | "problem";
  record_id: string;
  relation: "resolves" | "caused_by" | "related";
  record_number: string | null;
  record_title: string | null;
  record_state: string | null;
};
export type ChangeLinks = { links: ChangeLink[]; affected_cis: { id: string; name: string; ci_class: string }[] };
export type LinkCandidates = {
  incidents: { id: string; number: string; title: string; state: string }[];
  problems: { id: string; number: string; title: string; state: string }[];
};
export type IncidentLinks = {
  changes: { link_id: string; relation: string; id: string; number: string; title: string; state: RecordState; risk: string }[];
  problem: { id: string; number: string; title: string; state: string } | null;
};

export type IncidentQueueName = "active" | "mine" | "unassigned" | "at_risk" | "breached" | "completed" | "all";
export type QueueFilters = {
  queue: IncidentQueueName;
  q: string;
  priority: string;
  group: string;
  service: string;
  sort: "sla" | "priority" | "newest" | "oldest";
  page: number;
};
export type QueueRow = IncidentSummary & {
  assignee_id: string | null;
  group_name: string | null;
  assignee_name: string | null;
  service_name: string | null;
};
export type QueuePage = { results: QueueRow[]; total: number; page: number; page_size: number };

export type OperatorIncident = {
  title: string;
  description: string;
  impact: number;
  urgency: number;
  groupId: string | null;
  serviceId: string | null;
  category: string | null;
  subcategory: string | null;
  contactType: "phone" | "email" | "self_service" | "chat" | "walk_up";
};

const k = {
  services: (org: string) => ["orgs", org, "services"] as const,
  assets: (org: string) => ["orgs", org, "assets"] as const,
  catalogAdmin: (org: string) => ["orgs", org, "catalog-admin"] as const,
  tasks: (org: string, id: string) => ["orgs", org, "request-tasks", id] as const,
  changeLinks: (org: string, id: string) => ["orgs", org, "change-links", id] as const,
};

export function useServices(org: string) {
  return useQuery({
    queryKey: k.services(org),
    queryFn: () => api<{ results: Service[] }>(`orgs/${org}/services`).then((r) => r.results),
    staleTime: 5 * 60_000,
  });
}

export function useAssets(org: string, filters: { q: string; status: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  return useQuery({
    queryKey: [...k.assets(org), filters],
    queryFn: () => api<{ results: Asset[] }>(`orgs/${org}/assets?${params}`).then((r) => r.results),
  });
}

export function useAsset(org: string, id: string | null) {
  return useQuery({
    queryKey: [...k.assets(org), "detail", id],
    queryFn: () => api<Asset>(`orgs/${org}/assets/${id}`),
    enabled: !!id,
  });
}

function useInvalidating<TVars, TResult>(keys: readonly (readonly unknown[])[], request: (vars: TVars) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

export function useSaveAsset(org: string) {
  return useInvalidating([k.assets(org)], ({ id, expectedUpdatedAt, ...body }: AssetInput & { id?: string; expectedUpdatedAt?: string }) =>
    id
      ? api<Asset>(`orgs/${org}/assets/${id}`, { method: "PATCH", body: { ...body, expectedUpdatedAt } })
      : api<Asset>(`orgs/${org}/assets`, { method: "POST", body }),
  );
}

export function useAddRelationship(org: string) {
  return useInvalidating([k.assets(org)], ({ id, ...body }: { id: string; childId: string; relationshipType: string }) =>
    api<Asset>(`orgs/${org}/assets/${id}/relationships`, { method: "POST", body }),
  );
}

export function useRemoveRelationship(org: string) {
  return useInvalidating([k.assets(org)], ({ id, relationshipId }: { id: string; relationshipId: string }) =>
    api<Asset>(`orgs/${org}/assets/${id}/relationships/${relationshipId}`, { method: "DELETE" }),
  );
}

export function useCatalogAdmin(org: string, enabled: boolean) {
  return useQuery({
    queryKey: k.catalogAdmin(org),
    queryFn: () => api<{ results: CatalogAdminItem[] }>(`orgs/${org}/catalog/admin`).then((r) => r.results),
    enabled,
  });
}

export function useUpdateCatalogItem(org: string) {
  return useInvalidating(
    [k.catalogAdmin(org), ["orgs", org, "catalog"]],
    ({ id, ...body }: { id: string; expectedUpdatedAt: string; groupId?: string | null; priority?: number; approvalRequired?: boolean; active?: boolean }) =>
      api<CatalogAdminItem>(`orgs/${org}/catalog/${id}`, { method: "PATCH", body }),
  );
}

export function useRequestTasks(org: string, requestId: string, enabled: boolean) {
  return useQuery({
    queryKey: k.tasks(org, requestId),
    queryFn: () => api<{ results: RequestTask[] }>(`orgs/${org}/requests/${requestId}/tasks`).then((r) => r.results),
    enabled,
  });
}

export function useAddRequestTask(org: string, requestId: string) {
  return useInvalidating([k.tasks(org, requestId)], (body: { title: string; dueAt?: string }) =>
    api(`orgs/${org}/requests/${requestId}/tasks`, { method: "POST", body }),
  );
}

export function useSetRequestTaskState(org: string, requestId: string) {
  return useInvalidating([k.tasks(org, requestId)], ({ id, ...body }: { id: string; state: TaskState; expectedUpdatedAt: string }) =>
    api(`orgs/${org}/requests/${requestId}/tasks/${id}`, { method: "PATCH", body }),
  );
}

export function useChangeLinks(org: string, changeId: string) {
  return useQuery({ queryKey: k.changeLinks(org, changeId), queryFn: () => api<ChangeLinks>(`orgs/${org}/changes/${changeId}/links`) });
}

export function useLinkCandidates(org: string, enabled: boolean) {
  return useQuery({
    queryKey: ["orgs", org, "change-link-candidates"],
    queryFn: () => api<LinkCandidates>(`orgs/${org}/change-link-candidates`),
    enabled,
  });
}

export function useAddChangeLink(org: string, changeId: string) {
  return useInvalidating([k.changeLinks(org, changeId)], (body: { recordType: "incident" | "problem"; recordId: string; relation: string }) =>
    api<ChangeLinks>(`orgs/${org}/changes/${changeId}/links`, { method: "POST", body }),
  );
}

export function useRemoveChangeLink(org: string, changeId: string) {
  return useInvalidating([k.changeLinks(org, changeId)], (linkId: string) =>
    api<ChangeLinks>(`orgs/${org}/changes/${changeId}/links/${linkId}`, { method: "DELETE" }),
  );
}

export function useIncidentLinks(org: string, incidentId: string) {
  return useQuery({
    queryKey: ["orgs", org, "incident-links", incidentId],
    queryFn: () => api<IncidentLinks>(`orgs/${org}/incidents/${incidentId}/links`),
  });
}

export function useIncidentQueue(org: string, filters: QueueFilters) {
  const params = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
  return useQuery({
    queryKey: ["orgs", org, "incidents", "queue", filters],
    queryFn: () => api<QueuePage>(`orgs/${org}/incidents?${params}`),
    placeholderData: keepPreviousData,
  });
}

export function useQueueCounts(org: string) {
  return useQuery({
    queryKey: ["orgs", org, "incidents", "queue-counts"],
    queryFn: () => api<Record<IncidentQueueName, number>>(`orgs/${org}/incidents/queue-counts`),
  });
}

export function useCreateOperatorIncident(org: string) {
  return useInvalidating([["orgs", org, "incidents"]], (body: OperatorIncident) =>
    api<{ id: string; number: string }>(`orgs/${org}/incidents/operator`, { method: "POST", body }),
  );
}
