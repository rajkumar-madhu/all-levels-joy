import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./hooks";

// Administration, invitations, profile, notifications and audit trail.

export const ADMIN_ROLES = ["requester", "service_desk", "fulfiller", "change_manager", "cab_member", "cmdb_manager", "manager", "admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminMember = {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string;
  is_active: boolean;
  version: number;
  created_at: string;
  roles: AdminRole[];
};

export type AdminInvitation = {
  id: string;
  email: string;
  roles: AdminRole[];
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  created_at: string;
  version: number;
};

export type AdminGroup = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number;
  member_ids: string[];
};

export type AdminOverview = {
  organization: { id: string; name: string; timezone: string; admin_version: number };
  members: AdminMember[];
  invitations: AdminInvitation[];
  groups: AdminGroup[];
};

export type InvitationDetails = {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  roles: AdminRole[];
  status: AdminInvitation["status"];
  expires_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  locale: string | null;
  timezone: string | null;
  preferences: { emailDigest?: boolean } | null;
};

export type ProfileInput = {
  displayName: string;
  phone: string;
  jobTitle: string;
  department: string;
  locale: string;
  timezone: string;
  emailDigest: boolean;
};

export type Notification = {
  id: string;
  title: string;
  body: string | null;
  record_type: string | null;
  record_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  record_type: string;
  record_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  source: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  created_at: string;
};

const adminKey = (org: string) => ["orgs", org, "administration"] as const;

export function useAdministration(org: string, enabled = true) {
  return useQuery({ queryKey: adminKey(org), queryFn: () => api<AdminOverview>(`orgs/${org}/administration`), enabled });
}

/** Administration screens reload the snapshot after every mutation, rejected or not (versions may have moved). */
function useAdminMutation<TVars, TResult>(org: string, request: (vars: TVars) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: adminKey(org) }),
        client.invalidateQueries({ queryKey: keys.me }),
        client.invalidateQueries({ queryKey: ["orgs", org, "groups"] }),
      ]),
  });
}

export function useInviteMember(org: string) {
  return useAdminMutation(org, (body: { email: string; roles: AdminRole[] }) =>
    api<{ id: string }>(`orgs/${org}/administration/invitations`, { method: "POST", body }),
  );
}

export function useRevokeInvitation(org: string) {
  return useAdminMutation(org, ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
    api(`orgs/${org}/administration/invitations/${id}/revoke`, { method: "POST", body: { expectedVersion } }),
  );
}

export function useUpdateMember(org: string) {
  return useAdminMutation(
    org,
    ({ userId, ...body }: { userId: string; roles: AdminRole[]; isActive: boolean; expectedVersion: number }) =>
      api(`orgs/${org}/administration/members/${userId}`, { method: "PATCH", body }),
  );
}

export function useSaveGroup(org: string) {
  return useAdminMutation(
    org,
    ({ groupId, ...body }: { groupId: string | null; name: string; description: string; isActive: boolean; memberIds: string[]; expectedVersion?: number }) =>
      groupId
        ? api<{ id: string }>(`orgs/${org}/administration/groups/${groupId}`, { method: "PUT", body })
        : api<{ id: string }>(`orgs/${org}/administration/groups`, { method: "POST", body }),
  );
}

export function useUpdateWorkspaceSettings(org: string) {
  return useAdminMutation(org, (body: { name: string; timezone: string; expectedVersion: number }) =>
    api(`orgs/${org}/administration/workspace`, { method: "PATCH", body }),
  );
}

export function useInvitation(id: string | null) {
  return useQuery({
    queryKey: ["invitation", id],
    queryFn: () => api<InvitationDetails>(`invitations/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useAcceptInvitation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ organization_id: string }>(`invitations/${id}`, { method: "POST" }),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["invitation", id] }),
        client.invalidateQueries({ queryKey: keys.me }),
      ]),
  });
}

export function useProfile() {
  return useQuery({ queryKey: ["profile"], queryFn: () => api<Profile>("me/profile") });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileInput) => api<Profile>("me/profile", { method: "PATCH", body }),
    onSuccess: (profile) => {
      client.setQueryData(["profile"], profile);
      return client.invalidateQueries({ queryKey: keys.me });
    },
  });
}

const notificationsKey = (org: string) => ["orgs", org, "notifications"] as const;

export function useNotifications(org: string) {
  return useQuery({
    queryKey: notificationsKey(org),
    queryFn: () => api<{ results: Notification[]; unreadRecent: number }>(`orgs/${org}/notifications`),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true; marked: number }>(`orgs/${org}/notifications/read-all`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsKey(org) }),
  });
}

export function useAuditFacets(org: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["orgs", org, "audit-facets"],
    queryFn: () => api<{ recordTypes: string[] }>(`orgs/${org}/audit/facets`),
    staleTime: 60_000,
  });
}

export function useAuditTrail(org: string, filters: { recordType?: string; action?: string }, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: ["orgs", org, "audit", filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.recordType) params.set("recordType", filters.recordType);
      if (filters.action) params.set("action", filters.action);
      if (pageParam) params.set("before", pageParam);
      return api<{ results: AuditEvent[]; next: string | null }>(`orgs/${org}/audit?${params}`);
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
}
