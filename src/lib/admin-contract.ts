import { z } from "zod";

export const ADMIN_ROLES = [
  "requester",
  "service_desk",
  "fulfiller",
  "change_manager",
  "cab_member",
  "cmdb_manager",
  "manager",
  "admin",
] as const;
export const adminRoleSchema = z.enum(ADMIN_ROLES);
const roles = z
  .array(adminRoleSchema)
  .min(1)
  .max(8)
  .refine((items) => new Set(items).size === items.length, "Choose each role only once");
const uuid = z.string().uuid();
const version = z.number().int().positive();
const date = z.string();

export const adminMemberSchema = z.object({
  id: uuid,
  user_id: uuid,
  email: z.string().nullable(),
  display_name: z.string(),
  is_active: z.boolean(),
  version,
  created_at: date,
  roles: z.array(adminRoleSchema),
});
export const adminInvitationSchema = z.object({
  id: uuid,
  email: z.string(),
  roles: z.array(adminRoleSchema),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expires_at: date,
  created_at: date,
  version,
});
export const adminGroupSchema = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  version,
  member_ids: z.array(uuid),
});
export const adminOverviewSchema = z.object({
  organization: z.object({
    id: uuid,
    name: z.string(),
    timezone: z.string(),
    admin_version: version,
  }),
  members: z.array(adminMemberSchema),
  invitations: z.array(adminInvitationSchema),
  groups: z.array(adminGroupSchema),
});
export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  roles,
});
export const updateMemberSchema = z.object({
  userId: uuid,
  roles,
  isActive: z.boolean(),
  expectedVersion: version,
});
export const revokeInvitationSchema = z.object({ invitationId: uuid, expectedVersion: version });
export const saveGroupSchema = z
  .object({
    groupId: uuid.nullable(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000),
    isActive: z.boolean(),
    memberIds: z
      .array(uuid)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each member only once"),
    expectedVersion: version.nullable(),
  })
  .refine(
    (input) => (input.groupId === null) === (input.expectedVersion === null),
    "Refresh the group before saving",
  );
export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(100),
  expectedVersion: version,
});
export const invitationIdSchema = z.object({ invitationId: uuid });
export const invitationDetailsSchema = z.object({
  id: uuid,
  organization_id: uuid,
  organization_name: z.string(),
  email: z.string(),
  roles: z.array(adminRoleSchema),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expires_at: date,
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;
export type AdminMember = z.infer<typeof adminMemberSchema>;
export type AdminInvitation = z.infer<typeof adminInvitationSchema>;
export type AdminGroup = z.infer<typeof adminGroupSchema>;
export type InvitationDetails = z.infer<typeof invitationDetailsSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;
export type SaveGroupInput = z.infer<typeof saveGroupSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
