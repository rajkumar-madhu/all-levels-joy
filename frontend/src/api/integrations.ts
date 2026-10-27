import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type ToolState = "up" | "down" | "absent";

export type IntegrationStatus = {
  checkedAt: string;
  /** Configured or not; the API never returns the secrets themselves. */
  channels: { monitoring: boolean; pagerduty: boolean; scanner: boolean; slack: boolean; teams: boolean; email: boolean; assistant: boolean };
  endpoints: { alerts: string; pagerduty: string; scanner: string };
  scheduledJobs: { name: string; schedule: string }[];
  tools: { name: string; kind: string; url: string; state: ToolState }[];
};

const key = (org: string) => ["orgs", org, "integrations"] as const;

export function useIntegrationStatus(org: string, enabled: boolean) {
  return useQuery({
    queryKey: key(org),
    queryFn: () => api<IntegrationStatus>(`orgs/${org}/integrations/status`),
    enabled,
    staleTime: 30_000,
  });
}

export function useRecheckIntegrations(org: string) {
  const client = useQueryClient();
  return async () => {
    const fresh = await api<IntegrationStatus>(`orgs/${org}/integrations/status?force=1`);
    client.setQueryData(key(org), fresh);
  };
}

export type TestResult = { ok: boolean; message?: string; error?: string };

/** Sends one real test message (Slack, Teams) or email (to the caller) through a configured channel. */
export function useTestIntegration(org: string) {
  return useMutation({
    mutationFn: (channel: "slack" | "teams" | "email") =>
      api<TestResult>(`orgs/${org}/integrations/test`, { method: "POST", body: { channel } }),
  });
}
