import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signIn } from "@/auth/oidc";
import { useSession } from "@/stores/session";
import { api } from "./client";
import { ApiError, errorMessage } from "./errors";
import type { IncidentState } from "./types";

/* ------------------------------------------------------------------ types */

export type SlaTeam = {
  groupId: string | null;
  team: string;
  openRequests: number;
  openIncidents: number;
  dueSoon: number;
  breached: number;
};

export type SlaBreach = {
  recordType: "incident" | "request";
  id: string;
  number: string;
  title: string;
  state: IncidentState;
  priority: number | null;
  dueAt: string;
  team: string;
};

export type SlaOverview = { teams: SlaTeam[]; breached: SlaBreach[] };

export type Tally = { label: string; count: number };

export type IncidentMetrics = {
  windowDays: number;
  sampledRecent: boolean;
  opened: number;
  resolved: number;
  openTotal: number;
  unassigned: number;
  reopened: number;
  mttrHours: number | null;
  responseHours: number | null;
  slaAttainment: number | null;
  byPriority: { priority: number; open: number }[];
  byState: { state: IncidentState; count: number }[];
  byCategory: Tally[];
  byContactType: Tally[];
  byCloseCode: Tally[];
  serviceLoad: Tally[];
  days: { day: string; opened: number; resolved: number }[];
  ageing: {
    id: string;
    number: string;
    title: string;
    priority: number | null;
    state: IncidentState;
    createdAt: string;
    slaDueAt: string | null;
    service: string | null;
    ageDays: number;
  }[];
};

export type TimelineEntry = {
  id: string;
  label: string;
  at: string;
  actorName?: string | null;
  personName?: string | null;
  groupName?: string | null;
};

export type SlaTarget = {
  id: string;
  target_type: string;
  started_at: string;
  due_at: string;
  status: string;
  state: string;
  overdueMs: number | null;
  completedAt: string | null;
  paused: boolean;
};

export type RecordActivity = { timeline: TimelineEntry[]; slas: SlaTarget[] };

export type Attachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  uploader_name: string | null;
};

export type SearchResults = {
  incidents: { id: string; number: string; title: string; state: IncidentState; priority: number | null }[];
  requests: { id: string; number: string; title: string; state: IncidentState }[];
  changes: { id: string; number: string; title: string; state: IncidentState }[];
  knowledge: { id: string; number: string; title: string; status: string }[];
  assets: { id: string; name: string }[];
  catalog: { id: string; name: string; category: string | null }[];
  security: { id: string; number: string; title: string; state: string; severity: string }[];
};

export type TicketType = "incident" | "request";
export type AttachmentRecordType = "incident" | "request" | "change";

/* ------------------------------------------------------------------ queries */

export function useSlaOverview(org: string) {
  return useQuery({ queryKey: ["orgs", org, "sla"], queryFn: () => api<SlaOverview>(`orgs/${org}/sla`), refetchInterval: 60_000 });
}

export function useIncidentMetrics(org: string) {
  return useQuery({
    queryKey: ["orgs", org, "insights", "incidents"],
    queryFn: () => api<IncidentMetrics>(`orgs/${org}/insights/incidents`),
    staleTime: 30_000,
  });
}

export function useRecordActivity(org: string, recordType: TicketType, id: string) {
  return useQuery({
    queryKey: ["orgs", org, "activity", recordType, id],
    queryFn: () => api<RecordActivity>(`orgs/${org}/${recordType}s/${id}/activity`),
  });
}

export function useSearch(org: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["orgs", org, "search", q],
    queryFn: () => api<SearchResults>(`orgs/${org}/search?${new URLSearchParams({ q })}`),
    enabled: q.length >= 2 && q.length <= 80,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/* ------------------------------------------------------------------ attachments */

const base = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

/** Like `api`, for bodies and responses that are not JSON (uploads and file downloads). */
async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useSession.getState().accessToken;
  const response = await fetch(`${base}/api/v1/${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (response.status === 401) {
    useSession.getState().setSignedOut();
    void signIn();
  }
  if (!response.ok) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text
    }
    throw new ApiError(errorMessage(body), response.status);
  }
  return response;
}

export function useAttachments(org: string, recordType: AttachmentRecordType, id: string) {
  return useQuery({
    queryKey: ["orgs", org, "attachments", recordType, id],
    queryFn: () => api<{ results: Attachment[] }>(`orgs/${org}/${recordType}s/${id}/attachments`).then((r) => r.results),
  });
}

export function useUploadAttachment(org: string, recordType: AttachmentRecordType, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const response = await authorizedFetch(`orgs/${org}/${recordType}s/${id}/attachments`, { method: "POST", body: form });
      return ((await response.json()) as { results: Attachment[] }).results;
    },
    onSuccess: (rows) => {
      client.setQueryData(["orgs", org, "attachments", recordType, id], rows);
      return client.invalidateQueries({ queryKey: ["orgs", org, "activity", recordType, id] });
    },
  });
}

/** Downloads through the API (which checks access) and saves the file; nothing is ever publicly linked. */
export async function downloadAttachment(org: string, attachment: Attachment): Promise<void> {
  const response = await authorizedFetch(`orgs/${org}/attachments/${attachment.id}/download`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.file_name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
