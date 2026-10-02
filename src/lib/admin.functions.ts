import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { DEMO_ORG_ID, type AppRole } from "@/lib/itsm-shared";
import {
  adminOverviewSchema,
  inviteMemberSchema,
  updateMemberSchema,
  revokeInvitationSchema,
  saveGroupSchema,
  updateWorkspaceSchema,
  invitationIdSchema,
  invitationDetailsSchema,
  type InviteMemberInput,
  type UpdateMemberInput,
  type RevokeInvitationInput,
  type SaveGroupInput,
  type UpdateWorkspaceInput,
} from "@/lib/admin-contract";

// Keep migration-owned RPC signatures explicit without editing the generated
// Supabase snapshot. Every JSON response is validated at the server boundary.
type Rpc<Args> = { Args: Args; Returns: Json };
type Org = { _org_id: string };
type AdministrationDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      itsm_admin_overview: Rpc<Org>;
      itsm_admin_invite: Rpc<Org & { _email: string; _roles: AppRole[] }>;
      itsm_admin_update_member: Rpc<
        Org & {
          _user_id: string;
          _roles: AppRole[];
          _is_active: boolean;
          _expected_version: number;
        }
      >;
      itsm_admin_revoke_invitation: Rpc<
        Org & { _invitation_id: string; _expected_version: number }
      >;
      itsm_admin_save_group: Rpc<
        Org & {
          _group_id: string | null;
          _name: string;
          _description: string;
          _is_active: boolean;
          _member_ids: string[];
          _expected_version: number | null;
        }
      >;
      itsm_admin_update_workspace: Rpc<
        Org & { _name: string; _timezone: string; _expected_version: number }
      >;
      itsm_get_invitation: Rpc<{ _invitation_id: string }>;
      itsm_accept_invitation: Rpc<{ _invitation_id: string }>;
    };
  };
};
function adminClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<AdministrationDatabase>;
}
const idResult = z.object({ id: z.string().uuid() });
const okResult = z.object({ ok: z.literal(true) });

export const getAdministration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await adminClient(context.supabase).rpc("itsm_admin_overview", {
      _org_id: DEMO_ORG_ID,
    });
    if (error) throw new Error(error.message);
    return adminOverviewSchema.parse(data);
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: InviteMemberInput) => inviteMemberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc("itsm_admin_invite", {
      _org_id: DEMO_ORG_ID,
      _email: data.email,
      _roles: data.roles,
    });
    if (error) throw new Error(error.message);
    return idResult.parse(result);
  });

export const updateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: UpdateMemberInput) => updateMemberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc(
      "itsm_admin_update_member",
      {
        _org_id: DEMO_ORG_ID,
        _user_id: data.userId,
        _roles: data.roles,
        _is_active: data.isActive,
        _expected_version: data.expectedVersion,
      },
    );
    if (error) throw new Error(error.message);
    return okResult.parse(result);
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: RevokeInvitationInput) => revokeInvitationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc(
      "itsm_admin_revoke_invitation",
      {
        _org_id: DEMO_ORG_ID,
        _invitation_id: data.invitationId,
        _expected_version: data.expectedVersion,
      },
    );
    if (error) throw new Error(error.message);
    return okResult.parse(result);
  });

export const saveGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: SaveGroupInput) => saveGroupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc(
      "itsm_admin_save_group",
      {
        _org_id: DEMO_ORG_ID,
        _group_id: data.groupId,
        _name: data.name,
        _description: data.description,
        _is_active: data.isActive,
        _member_ids: data.memberIds,
        _expected_version: data.expectedVersion as number,
      },
    );
    if (error) throw new Error(error.message);
    return idResult.parse(result);
  });

export const updateWorkspaceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: UpdateWorkspaceInput) => updateWorkspaceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc(
      "itsm_admin_update_workspace",
      {
        _org_id: DEMO_ORG_ID,
        _name: data.name,
        _timezone: data.timezone,
        _expected_version: data.expectedVersion,
      },
    );
    if (error) throw new Error(error.message);
    return okResult.parse(result);
  });

export const getInvitation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { invitationId: string }) => invitationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc("itsm_get_invitation", {
      _invitation_id: data.invitationId,
    });
    if (error) throw new Error(error.message);
    return invitationDetailsSchema.parse(result);
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { invitationId: string }) => invitationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await adminClient(context.supabase).rpc(
      "itsm_accept_invitation",
      { _invitation_id: data.invitationId },
    );
    if (error) throw new Error(error.message);
    return z.object({ organization_id: z.string().uuid() }).parse(result);
  });
