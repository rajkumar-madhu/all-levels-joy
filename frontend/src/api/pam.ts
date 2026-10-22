import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type Environment = "production" | "dr" | "uat" | "development";
export type Risk = "critical" | "high" | "medium" | "low";
export type Template = "ssh" | "database" | "windows" | "api_key";

export type Secret = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  template: Template;
  environment: Environment;
  folder: string;
  description: string;
  owner_group_id: string | null;
  owner_group_name: string | null;
  approval_required: boolean;
  max_checkout_minutes: number;
  rotation_enabled: boolean;
  rotation_interval_days: number;
  rotate_after_checkout: boolean;
  verify_enabled: boolean;
  password_changed_at: string | null;
  next_rotation_at: string | null;
  last_verified_at: string | null;
  last_verification_ok: boolean | null;
  last_rotation_error: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  risk: Risk;
  risk_reasons: string[];
};

export type AccessStatus = "pending" | "approved" | "rejected" | "cancelled" | "checked_in" | "expired";

export type AccessRequest = {
  id: string;
  secret_id: string;
  secret_name: string;
  secret_host: string;
  secret_environment: Environment;
  requester_id: string;
  requester_name: string | null;
  reason: string;
  ticket_reference: string | null;
  duration_minutes: number;
  status: AccessStatus;
  approver_id: string | null;
  approver_name: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  checked_in_at: string | null;
  reveal_count: number;
  created_at: string;
};

export type PamEvent = { id: number; action: string; detail: Record<string, unknown>; created_at: string; actor_name: string | null };

export type SecretDetail = Secret & { events: PamEvent[]; requests: AccessRequest[]; my_request: AccessRequest | null; is_custodian: boolean };

export type SecretList = {
  results: Secret[];
  summary: { total: number; automatic_rotation_pct: number; used_never_rotated: number; never_verified: number; sessions_today: number };
  environment_counts: Record<"all" | Environment, number>;
  folders: string[];
  groups: { id: string; name: string }[];
  is_custodian: boolean;
};

export type SecretFilters = { environment?: Environment; risk?: Risk; q?: string; usedNeverRotated?: boolean };

export type SecretFields = {
  name: string;
  host: string;
  port: number;
  username: string;
  template: Template;
  environment: Environment;
  folder: string;
  description?: string;
  ownerGroupId?: string | null;
  approvalRequired: boolean;
  maxCheckoutMinutes: number;
  rotationEnabled: boolean;
  rotationIntervalDays: number;
  rotateAfterCheckout: boolean;
  verifyEnabled: boolean;
};

export type SecretUpdate = Partial<SecretFields> & { expectedUpdatedAt: string };
export type BulkAction = { ids: string[]; action: "enable_rotation" | "disable_rotation" | "verify" | "move"; folder?: string };
export type ActionResult = { ok: boolean; error?: string | null };

const pamKey = (org: string) => ["orgs", org, "pam"] as const;

export function useSecrets(org: string, filters: SecretFilters, enabled: boolean) {
  const params = new URLSearchParams();
  if (filters.environment) params.set("environment", filters.environment);
  if (filters.risk) params.set("risk", filters.risk);
  if (filters.q) params.set("q", filters.q);
  if (filters.usedNeverRotated) params.set("usedNeverRotated", "true");
  return useQuery({
    queryKey: [...pamKey(org), "secrets", filters],
    queryFn: () => api<SecretList>(`orgs/${org}/pam/secrets?${params}`),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useSecret(org: string, id: string | null) {
  return useQuery({
    queryKey: [...pamKey(org), "secret", id],
    queryFn: () => api<SecretDetail>(`orgs/${org}/pam/secrets/${id}`),
    enabled: Boolean(id),
  });
}

function usePamMutation<B, R>(org: string, fn: (body: B) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: pamKey(org) }) });
}

export const useCreateSecret = (org: string) =>
  usePamMutation(org, (body: SecretFields & { password: string }) => api<Secret>(`orgs/${org}/pam/secrets`, { method: "POST", body }));

export const useUpdateSecret = (org: string, id: string) =>
  usePamMutation(org, (body: SecretUpdate) => api<Secret>(`orgs/${org}/pam/secrets/${id}`, { method: "PATCH", body }));

export const useDeleteSecret = (org: string, id: string) =>
  usePamMutation(org, () => api<null>(`orgs/${org}/pam/secrets/${id}`, { method: "DELETE" }));

export const useSetPassword = (org: string, id: string) =>
  usePamMutation(org, (password: string) => api<Secret>(`orgs/${org}/pam/secrets/${id}/password`, { method: "POST", body: { password } }));

export const useSecretAction = (org: string, id: string) =>
  usePamMutation(org, (action: "rotate" | "verify") =>
    api<ActionResult & { secret: Secret }>(`orgs/${org}/pam/secrets/${id}/${action}`, { method: "POST" }),
  );

export const useBulkAction = (org: string) =>
  usePamMutation(org, (body: BulkAction) =>
    api<{ action: string; results: (ActionResult & { id: string; name: string })[] }>(`orgs/${org}/pam/secrets/bulk`, { method: "POST", body }),
  );

export function useAccessRequests(org: string, scope: "mine" | "approvals" | "all", enabled: boolean) {
  return useQuery({
    queryKey: [...pamKey(org), "requests", scope],
    queryFn: () => api<{ results: AccessRequest[]; is_custodian: boolean }>(`orgs/${org}/pam/requests?scope=${scope}`),
    enabled,
    // Approvals and expiries happen elsewhere; keep the list current while it is open.
    refetchInterval: 30_000,
  });
}

export const useRequestAccess = (org: string) =>
  usePamMutation(org, (body: { secretId: string; reason: string; ticketReference?: string; durationMinutes: number }) =>
    api<AccessRequest>(`orgs/${org}/pam/requests`, { method: "POST", body }),
  );

export const useDecideAccess = (org: string) =>
  usePamMutation(org, ({ id, ...body }: { id: string; decision: "approve" | "reject"; notes?: string }) =>
    api<AccessRequest>(`orgs/${org}/pam/requests/${id}/decision`, { method: "POST", body }),
  );

export const useAccessAction = (org: string) =>
  usePamMutation(org, ({ id, action }: { id: string; action: "check-in" | "cancel" }) =>
    api<AccessRequest>(`orgs/${org}/pam/requests/${id}/${action}`, { method: "POST" }),
  );

/** Not cached: the password lives only in the component that asked for it. */
export const revealPassword = (org: string, id: string) =>
  api<{ password: string; expires_at: string }>(`orgs/${org}/pam/requests/${id}/reveal`, { method: "POST" });
