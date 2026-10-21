import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { IncidentState, RecordState } from "./types";

export type Problem = {
  id: string;
  number: string;
  title: string;
  description: string;
  state: RecordState;
  impact: number;
  urgency: number;
  priority: number | null;
  category: string | null;
  service_id: string | null;
  service_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  known_error: boolean;
  workaround: string | null;
  root_cause: string | null;
  fix_plan: string | null;
  resolution_notes: string | null;
  knowledge_article_id: string | null;
  knowledge_article_number: string | null;
  knowledge_article_title: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  incident_count: number;
};

export type LinkedIncident = { id: string; number: string; title: string; state: IncidentState; priority: number | null; major_incident: boolean };

export type ProblemDetail = Problem & {
  incidents: LinkedIncident[];
  candidates: { id: string; number: string; title: string; state: IncidentState }[];
  articles: { id: string; number: string; title: string; status: string }[];
};

export type NewProblem = {
  title: string;
  description: string;
  impact: number;
  urgency: number;
  category?: string;
  serviceId?: string | null;
  fromIncidentId?: string | null;
  assignToMe?: boolean;
};

/** Only the fields present are changed; expectedUpdatedAt guards against overwriting someone else's edit. */
export type ProblemUpdate = {
  expectedUpdatedAt: string;
  state?: RecordState;
  assignToMe?: boolean;
  knownError?: boolean;
  workaround?: string | null;
  rootCause?: string | null;
  fixPlan?: string | null;
  resolutionNotes?: string | null;
  impact?: number;
  urgency?: number;
  knowledgeArticleId?: string | null;
};

const problemsKey = (org: string) => ["orgs", org, "problems"] as const;

export function useProblems(org: string, filters: { state?: string; knownError?: boolean }, enabled: boolean) {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.knownError) params.set("knownError", "true");
  return useQuery({
    queryKey: [...problemsKey(org), filters],
    queryFn: () => api<{ results: Problem[]; services: { id: string; name: string }[] }>(`orgs/${org}/problems?${params}`),
    enabled,
  });
}

export function useProblem(org: string, id: string) {
  return useQuery({ queryKey: [...problemsKey(org), id], queryFn: () => api<ProblemDetail>(`orgs/${org}/problems/${id}`) });
}

export function useCreateProblem(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NewProblem) => api<{ id: string; number: string }>(`orgs/${org}/problems`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: problemsKey(org) }),
  });
}

export function useUpdateProblem(org: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ProblemUpdate) => api<ProblemDetail>(`orgs/${org}/problems/${id}`, { method: "PATCH", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: problemsKey(org) }),
  });
}

export function useLinkIncident(org: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { incidentId: string; linked: boolean }) =>
      api<ProblemDetail>(`orgs/${org}/problems/${id}/incidents`, { method: "POST", body }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: problemsKey(org) }),
        client.invalidateQueries({ queryKey: ["orgs", org, "incidents"] }),
      ]),
  });
}
