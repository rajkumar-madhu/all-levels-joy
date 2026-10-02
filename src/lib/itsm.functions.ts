import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { nextRecordNumber } from "@/lib/record-number";
import { DEMO_ORG_ID, type AppRole } from "@/lib/itsm-shared";
import {
  buildIncidentWorkflowPatch,
  canManageIncidents,
  INCIDENT_CONFLICT_MESSAGE,
  incidentSlaAttainment,
  incidentUpdateSchema,
  type IncidentWorkflowInput,
} from "@/lib/incident-workflow";

type ChangeUpdate = Database["public"]["Tables"]["changes"]["Update"];
type TypedSupabaseClient = SupabaseClient<Database>;

const uuid = z.string().uuid();

async function writeAudit(
  supabase: TypedSupabaseClient,
  actorId: string,
  recordType: string,
  recordId: string | null,
  action: string,
  after?: Json,
) {
  await supabase.from("audit_events").insert({
    organization_id: DEMO_ORG_ID,
    record_type: recordType,
    record_id: recordId,
    actor_id: actorId,
    action,
    after_values: after ?? null,
  });
}

async function loadRoles(supabase: TypedSupabaseClient, userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("organization_id", DEMO_ORG_ID)
    .eq("user_id", userId);
  if (error) throw new Error(`Workspace permissions could not be loaded: ${error.message}`);
  return (data ?? []).map((row: { role: AppRole }) => row.role);
}

function requireRoles(roles: AppRole[], allowed: AppRole[]) {
  if (!roles.some((role) => allowed.includes(role))) {
    throw new Error("You do not have permission to perform this action.");
  }
}

/** Provision only a profile/requester role for an existing active workspace member. */
export const bootstrapWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { displayName?: string } | undefined) =>
    z.object({ displayName: z.string().trim().max(120).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const fallback =
      typeof context.claims["email"] === "string"
        ? context.claims["email"].split("@")[0]
        : "New user";
    const { error } = await context.supabase.rpc("bootstrap_workspace", {
      _display_name: data.displayName || fallback || "New user",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [org, profile, roles, incidents, requests, changes, approvals, notifications, audit] =
      await Promise.all([
        supabase.from("organizations").select("*").eq("id", DEMO_ORG_ID).maybeSingle(),
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        loadRoles(supabase, userId),
        supabase
          .from("incidents")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("priority")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("service_requests")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("changes")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("start_at", { ascending: true })
          .limit(200),
        supabase
          .from("approvals")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("audit_events")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

    for (const result of [
      org,
      profile,
      incidents,
      requests,
      changes,
      approvals,
      notifications,
      audit,
    ]) {
      if (result.error)
        throw new Error(`Workspace data could not be loaded: ${result.error.message}`);
    }

    if (!org.data) throw new Error("Your account no longer has active access to this workspace.");
    return {
      userId,
      organization: org.data,
      profile: profile.data,
      roles,
      incidents: incidents.data ?? [],
      requests: requests.data ?? [],
      changes: changes.data ?? [],
      approvals: approvals.data ?? [],
      notifications: notifications.data ?? [],
      audit: audit.data ?? [],
    };
  });

export const getReferenceData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [services, groups, catalog, knowledge, assets, relationships, people] = await Promise.all(
      [
        supabase.from("services").select("*").eq("organization_id", DEMO_ORG_ID).order("name"),
        supabase
          .from("groups")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("name")
          .returns<
            Array<
              Database["public"]["Tables"]["groups"]["Row"] & {
                is_active: boolean;
                version: number;
              }
            >
          >(),
        supabase
          .from("catalog_items")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .eq("active", true)
          .order("category"),
        supabase
          .from("knowledge_articles")
          .select("*")
          .eq("organization_id", DEMO_ORG_ID)
          .order("updated_at", { ascending: false }),
        supabase
          .from("configuration_items")
          .select(
            "id, organization_id, name, ci_class, asset_tag, environment, status, criticality, owner_id, service_id, location, last_discovered_at, created_at, updated_at",
          )
          .eq("organization_id", DEMO_ORG_ID)
          .order("ci_class"),
        supabase.from("ci_relationships").select("*").eq("organization_id", DEMO_ORG_ID),
        supabase.from("profiles").select("id, display_name, department, job_title").limit(200),
      ],
    );

    for (const result of [services, groups, catalog, knowledge, assets, relationships, people]) {
      if (result.error)
        throw new Error(`Reference data could not be loaded: ${result.error.message}`);
    }

    return {
      services: services.data ?? [],
      groups: groups.data ?? [],
      catalog: catalog.data ?? [],
      knowledge: knowledge.data ?? [],
      assets: assets.data ?? [],
      relationships: relationships.data ?? [],
      people: people.data ?? [],
    };
  });

export const getRecordActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { recordType: string; recordId: string }) =>
    z.object({ recordType: z.string().max(40), recordId: uuid }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [comments, audit] = await Promise.all([
      supabase
        .from("record_comments")
        .select("*")
        .eq("record_type", data.recordType)
        .eq("record_id", data.recordId)
        .order("created_at", { ascending: true }),
      supabase
        .from("audit_events")
        .select("*")
        .eq("record_type", data.recordType)
        .eq("record_id", data.recordId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (comments.error) throw new Error(comments.error.message);
    if (audit.error) throw new Error(audit.error.message);
    return { comments: comments.data ?? [], audit: audit.data ?? [] };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { recordType: string; recordId: string; body: string; internal?: boolean }) =>
    z
      .object({
        recordType: z.string().max(40),
        recordId: uuid,
        body: z.string().trim().min(1).max(4000),
        internal: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadRoles(supabase, userId);
    if (data.internal) {
      requireRoles(roles, [
        "service_desk",
        "fulfiller",
        "manager",
        "admin",
        "change_manager",
        "cab_member",
        "cmdb_manager",
      ]);
    }
    const { error } = await supabase.from("record_comments").insert({
      organization_id: DEMO_ORG_ID,
      record_type: data.recordType,
      record_id: data.recordId,
      author_id: userId,
      body: data.body,
      internal: Boolean(data.internal),
    });
    if (error) throw new Error(error.message);
    await writeAudit(supabase, userId, data.recordType, data.recordId, "comment_added");
    return { ok: true };
  });

export const createIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      title: string;
      description: string;
      impact: number;
      urgency: number;
      serviceId?: string | null;
      ownerId?: string | null;
      groupId?: string | null;
      category?: string | null;
      subcategory?: string | null;
      contactType?: string | null;
    }) =>
      z
        .object({
          title: z.string().trim().min(5).max(160),
          description: z.string().trim().min(5).max(6000),
          impact: z.number().int().min(1).max(3),
          urgency: z.number().int().min(1).max(3),
          serviceId: uuid.nullish(),
          ownerId: uuid.nullish(),
          groupId: uuid.nullish(),
          category: z.string().trim().max(40).nullish(),
          subcategory: z.string().trim().max(60).nullish(),
          contactType: z.string().trim().max(40).nullish(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const number = await nextRecordNumber(supabase, DEMO_ORG_ID, "INC");
    const severity = data.impact + data.urgency;
    const dueHours = severity <= 2 ? 2 : severity <= 4 ? 8 : 24;

    const { data: incident, error } = await supabase
      .from("incidents")
      .insert({
        organization_id: DEMO_ORG_ID,
        number,
        title: data.title,
        description: data.description,
        impact: data.impact,
        urgency: data.urgency,
        requester_id: userId,
        service_id: data.serviceId ?? null,
        group_id: data.groupId ?? null,
        category: data.category || null,
        subcategory: data.subcategory || null,
        contact_type: data.contactType || "self_service",
        sla_due_at: new Date(Date.now() + dueHours * 3600_000).toISOString(),
        state: "new",
      })
      .select("id, number")
      .single();
    if (error) throw new Error(error.message);

    return incident;
  });

export const updateIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: IncidentWorkflowInput) => incidentUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadRoles(supabase, userId);
    if (!canManageIncidents(roles)) {
      throw new Error("You do not have permission to manage incidents.");
    }

    const { data: current, error: currentError } = await supabase
      .from("incidents")
      .select(
        "state, updated_at, first_responded_at, reopen_count, resolved_at, resolution_notes, close_code, on_hold_reason",
      )
      .eq("organization_id", DEMO_ORG_ID)
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error("This incident was not found or is no longer accessible.");

    const patch = buildIncidentWorkflowPatch(current, data, userId);
    if (data.groupId) {
      const { data: group, error: groupError } = await supabase
        .from("groups")
        .select("id")
        .eq("organization_id", DEMO_ORG_ID)
        .eq("id", data.groupId)
        .maybeSingle();
      if (groupError) throw new Error(groupError.message);
      if (!group) throw new Error("The selected group is not available in this organization.");
    }
    if (Object.keys(patch).length === 0) return { ok: true, updatedAt: current.updated_at };

    const { data: updated, error } = await supabase
      .from("incidents")
      .update(patch)
      .eq("organization_id", DEMO_ORG_ID)
      .eq("id", data.id)
      .eq("updated_at", data.expectedUpdatedAt)
      .select("id, updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error(INCIDENT_CONFLICT_MESSAGE);
    return { ok: true, updatedAt: updated.updated_at };
  });

export const updateServiceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; state: string; expectedUpdatedAt: string }) =>
    z
      .object({
        id: uuid,
        expectedUpdatedAt: z.string().datetime({ offset: true }),
        state: z.enum(["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadRoles(supabase, userId);
    requireRoles(roles, ["service_desk", "fulfiller", "manager", "admin"]);
    const { data: updated, error } = await supabase
      .from("service_requests")
      .update({ state: data.state })
      .eq("organization_id", DEMO_ORG_ID)
      .eq("id", data.id)
      .eq("updated_at", data.expectedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated)
      throw new Error("This request changed or is no longer accessible. Refresh and try again.");
    return { ok: true };
  });

export const updateChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      action: "start" | "deliver" | "close" | "cancel";
      pirNotes?: string;
      deliveryOutcome?: "successful" | "successful_with_issues" | "failed" | "rolled_back";
      validationResults?: string;
      rollbackUsed?: boolean;
    }) =>
      z
        .object({
          id: uuid,
          action: z.enum(["start", "deliver", "close", "cancel"]),
          pirNotes: z.string().trim().max(6000).optional(),
          deliveryOutcome: z
            .enum(["successful", "successful_with_issues", "failed", "rolled_back"])
            .optional(),
          validationResults: z.string().trim().max(6000).optional(),
          rollbackUsed: z.boolean().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadRoles(supabase, userId);
    requireRoles(roles, ["change_manager", "admin"]);
    const { data: current, error: currentError } = await supabase
      .from("changes")
      .select("*")
      .eq("organization_id", DEMO_ORG_ID)
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error("That change no longer exists.");
    const patch: ChangeUpdate = {};
    if (data.action === "start") {
      if (
        current.state !== "open" ||
        !["approved", "not_required"].includes(current.approval_status)
      ) {
        throw new Error("The change must be approved and scheduled before implementation starts.");
      }
      if (current.start_at && new Date(current.start_at) > new Date()) {
        throw new Error("Implementation cannot start before the scheduled window.");
      }
      patch["state"] = "in_progress";
      patch["actual_start_at"] = new Date().toISOString();
    } else if (data.action === "deliver") {
      if (current.state !== "in_progress")
        throw new Error("Start implementation before recording delivery.");
      if (!data.deliveryOutcome || !data.validationResults?.trim() || !data.pirNotes?.trim()) {
        throw new Error("Delivery outcome, validation results, and review notes are required.");
      }
      patch["state"] = "resolved";
      patch["actual_end_at"] = new Date().toISOString();
      patch["delivered_at"] = new Date().toISOString();
      patch["delivery_outcome"] = data.deliveryOutcome;
      patch["validation_results"] = data.validationResults;
      patch["rollback_used"] = data.rollbackUsed ?? false;
      patch["pir_notes"] = data.pirNotes;
    } else if (data.action === "close") {
      if (current.state !== "resolved" || !current.pir_notes || !current.validation_results) {
        throw new Error(
          "Delivery evidence and a post-implementation review are required before closure.",
        );
      }
      patch["state"] = "closed";
      patch["closed_at"] = new Date().toISOString();
    } else {
      if (["resolved", "closed"].includes(current.state))
        throw new Error("A delivered change cannot be cancelled.");
      patch["state"] = "cancelled";
    }
    const { data: updated, error } = await supabase
      .from("changes")
      .update(patch)
      .eq("organization_id", DEMO_ORG_ID)
      .eq("id", data.id)
      .eq("updated_at", current.updated_at)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated)
      throw new Error("This change was updated by another person. Refresh and try again.");
    return { ok: true };
  });

export const saveKnowledgeArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id?: string | null;
      title: string;
      summary: string;
      content: string;
      category: string;
      status: string;
    }) =>
      z
        .object({
          id: uuid.nullish(),
          title: z.string().trim().min(5).max(160),
          summary: z.string().trim().max(400),
          content: z.string().trim().min(10).max(20000),
          category: z.string().trim().min(2).max(60),
          status: z.enum(["draft", "review", "published", "retired"]),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadRoles(supabase, userId);
    requireRoles(roles, ["service_desk", "fulfiller", "manager", "admin", "change_manager"]);

    if (data.id) {
      const { error } = await supabase
        .from("knowledge_articles")
        .update({
          title: data.title,
          summary: data.summary,
          content: data.content,
          category: data.category,
          status: data.status,
          published_at: data.status === "published" ? new Date().toISOString() : null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await writeAudit(supabase, userId, "knowledge", data.id, "updated", { status: data.status });
      return { id: data.id };
    }

    const number = await nextRecordNumber(supabase, DEMO_ORG_ID, "KB");
    const { data: article, error } = await supabase
      .from("knowledge_articles")
      .insert({
        organization_id: DEMO_ORG_ID,
        number,
        title: data.title,
        summary: data.summary,
        content: data.content,
        category: data.category,
        status: data.status,
        author_id: userId,
        published_at: data.status === "published" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(supabase, userId, "knowledge", article.id, "created", { number });
    return article;
  });

export const saveConfigurationItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id?: string | null;
      name: string;
      ciClass: string;
      environment: string;
      status: string;
      criticality: string;
      location: string;
      serviceId?: string | null;
    }) =>
      z
        .object({
          id: uuid.nullish(),
          name: z.string().trim().min(2).max(120),
          ciClass: z.string().trim().min(2).max(80),
          environment: z.string().trim().max(40),
          status: z.enum(["operational", "degraded", "maintenance", "retired"]),
          criticality: z.enum(["low", "medium", "high", "critical"]),
          location: z.string().trim().max(120),
          serviceId: uuid.nullish(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadRoles(supabase, userId);
    requireRoles(roles, ["cmdb_manager", "admin"]);

    const payload = {
      organization_id: DEMO_ORG_ID,
      name: data.name,
      ci_class: data.ciClass,
      environment: data.environment || null,
      status: data.status,
      criticality: data.criticality,
      location: data.location || null,
      service_id: data.serviceId ?? null,
      owner_id: userId,
    };

    if (data.id) {
      const { error } = await supabase
        .from("configuration_items")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await writeAudit(supabase, userId, "asset", data.id, "updated", { name: data.name });
      return { id: data.id };
    }

    const { data: ci, error } = await supabase
      .from("configuration_items")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(supabase, userId, "asset", ci.id, "created", { name: data.name });
    return ci;
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      displayName: string;
      phone: string;
      jobTitle: string;
      department: string;
      locale: string;
      timezone: string;
      avatarUrl?: string | null;
      emailDigest: boolean;
    }) =>
      z
        .object({
          displayName: z.string().trim().min(2).max(120),
          phone: z.string().trim().max(40),
          jobTitle: z.string().trim().max(120),
          department: z.string().trim().max(120),
          locale: z.string().trim().min(2).max(20),
          timezone: z.string().trim().min(2).max(60),
          avatarUrl: z.string().trim().max(500).nullish(),
          emailDigest: z.boolean(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: data.displayName,
        phone: data.phone || null,
        job_title: data.jobTitle || null,
        department: data.department || null,
        locale: data.locale,
        timezone: data.timezone,
        avatar_url: data.avatarUrl || null,
        preferences: { emailDigest: data.emailDigest },
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    await writeAudit(supabase, userId, "profile", userId, "updated");
    return { ok: true };
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { query: string }) =>
    z.object({ query: z.string().trim().min(2).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const escaped = data.query.replace(/[%_,]/g, " ").trim();
    const term = `%${escaped}%`;
    const match = `number.ilike.${term},title.ilike.${term}`;
    const knowledgeMatch = `${match},summary.ilike.${term},category.ilike.${term},content.ilike.${term}`;

    const [incidents, requests, changes, knowledge, assets, catalog] = await Promise.all([
      supabase
        .from("incidents")
        .select("id, number, title, state, priority")
        .eq("organization_id", DEMO_ORG_ID)
        .or(match)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("service_requests")
        .select("id, number, title, state")
        .eq("organization_id", DEMO_ORG_ID)
        .or(match)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("changes")
        .select("id, number, title, state")
        .eq("organization_id", DEMO_ORG_ID)
        .or(match)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("knowledge_articles")
        .select("id, number, title, status")
        .eq("organization_id", DEMO_ORG_ID)
        .or(knowledgeMatch)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("configuration_items")
        .select("id, name")
        .eq("organization_id", DEMO_ORG_ID)
        .ilike("name", term)
        .order("name")
        .limit(5),
      supabase
        .from("catalog_items")
        .select("id, name, category")
        .eq("organization_id", DEMO_ORG_ID)
        .eq("active", true)
        .or(`name.ilike.${term},category.ilike.${term},description.ilike.${term}`)
        .order("name")
        .limit(5),
    ]);

    return {
      incidents: incidents.data ?? [],
      requests: requests.data ?? [],
      changes: changes.data ?? [],
      knowledge: knowledge.data ?? [],
      assets: assets.data ?? [],
      catalog: catalog.data ?? [],
    };
  });

export const listAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { recordType: string; recordId: string }) =>
    z.object({ recordType: z.string().min(2).max(40), recordId: uuid }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase
      .from("attachments")
      .select("id, file_name, mime_type, size_bytes, storage_path, created_at")
      .eq("organization_id", DEMO_ORG_ID)
      .eq("record_type", data.recordType)
      .eq("record_id", data.recordId)
      .order("created_at", { ascending: false });
    return rows ?? [];
  });

export const registerAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      recordType: string;
      recordId: string;
      storagePath: string;
      fileName: string;
      mimeType?: string;
      sizeBytes?: number;
    }) =>
      z
        .object({
          recordType: z.string().min(2).max(40),
          recordId: uuid,
          storagePath: z.string().min(10).max(400),
          fileName: z.string().trim().min(1).max(200),
          mimeType: z.string().max(120).optional(),
          sizeBytes: z.number().int().nonnegative().max(26_214_400).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.storagePath.startsWith(`${DEMO_ORG_ID}/`)) {
      throw new Error("Attachment path is not valid for this workspace.");
    }
    const { error } = await supabase.from("attachments").insert({
      organization_id: DEMO_ORG_ID,
      record_type: data.recordType,
      record_id: data.recordId,
      uploader_id: userId,
      storage_path: data.storagePath,
      file_name: data.fileName,
      mime_type: data.mimeType ?? null,
      size_bytes: data.sizeBytes ?? null,
    });
    if (error) throw new Error(error.message);
    await writeAudit(supabase, userId, data.recordType, data.recordId, "attachment_added", {
      file_name: data.fileName,
    });
    return { ok: true };
  });

export const getIncidentMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [recent, openRows, services] = await Promise.all([
      supabase
        .from("incidents")
        .select(
          "id, number, title, state, priority, category, contact_type, close_code, reopen_count, service_id, created_at, resolved_at, first_responded_at, sla_due_at",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("incidents")
        .select(
          "id, number, title, state, priority, category, contact_type, service_id, created_at, sla_due_at, resolved_at, assignee_id, group_id",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .not("state", "in", "(resolved,closed,cancelled)")
        .order("priority")
        .limit(500),
      supabase.from("services").select("id, name").eq("organization_id", DEMO_ORG_ID),
    ]);

    for (const result of [recent, openRows, services]) {
      if (result.error) throw new Error(result.error.message);
    }

    const recentRows = recent.data ?? [];
    const open = openRows.data ?? [];
    const serviceNames = new Map((services.data ?? []).map((s) => [s.id, s.name]));

    const days: { day: string; opened: number; resolved: number }[] = [];
    for (let index = 13; index >= 0; index -= 1) {
      const key = new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10);
      days.push({
        day: key,
        opened: recentRows.filter((row) => (row.created_at ?? "").slice(0, 10) === key).length,
        resolved: recentRows.filter((row) => (row.resolved_at ?? "").slice(0, 10) === key).length,
      });
    }

    const tally = (rows: typeof recentRows, key: "category" | "contact_type" | "close_code") => {
      const map = new Map<string, number>();
      rows.forEach((row) => {
        const value = (row[key] as string | null) || "unspecified";
        map.set(value, (map.get(value) ?? 0) + 1);
      });
      return [...map.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    };

    const resolvedRows = recentRows.filter((row) => row.resolved_at);
    const average = (values: number[]) =>
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

    const mttrHours = average(
      resolvedRows.map(
        (row) =>
          (new Date(row.resolved_at as string).getTime() - new Date(row.created_at).getTime()) /
          3_600_000,
      ),
    );
    const responseHours = average(
      recentRows
        .filter((row) => row.first_responded_at)
        .map(
          (row) =>
            (new Date(row.first_responded_at as string).getTime() -
              new Date(row.created_at).getTime()) /
            3_600_000,
        ),
    );

    const serviceCounts = new Map<string, number>();
    open.forEach((row) => {
      const name = row.service_id ? (serviceNames.get(row.service_id) ?? "Unknown") : "Unassigned";
      serviceCounts.set(name, (serviceCounts.get(name) ?? 0) + 1);
    });

    return {
      windowDays: 30,
      opened: recentRows.length,
      resolved: resolvedRows.length,
      openTotal: open.length,
      unassigned: open.filter((row) => !row.assignee_id).length,
      reopened: recentRows.filter((row) => (row.reopen_count ?? 0) > 0).length,
      mttrHours,
      responseHours,
      slaAttainment: incidentSlaAttainment(resolvedRows),
      byPriority: [1, 2, 3, 4, 5].map((priority) => ({
        priority,
        open: open.filter((row) => (row.priority ?? 5) === priority).length,
      })),
      byState: [...new Set(open.map((row) => row.state))].map((state) => ({
        state: state as string,
        count: open.filter((row) => row.state === state).length,
      })),
      byCategory: tally(recentRows, "category"),
      byContactType: tally(recentRows, "contact_type"),
      byCloseCode: tally(resolvedRows, "close_code"),
      serviceLoad: [...serviceCounts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      days,
      ageing: open
        .map((row) => ({
          id: row.id,
          number: row.number,
          title: row.title,
          priority: row.priority,
          state: row.state as string,
          createdAt: row.created_at,
          slaDueAt: row.sla_due_at,
          service: row.service_id ? (serviceNames.get(row.service_id) ?? null) : null,
          ageDays: Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000),
        }))
        .sort((a, b) => b.ageDays - a.ageDays)
        .slice(0, 8),
    };
  });

export { createServiceRequest, createChange, decideApproval } from "./approval.functions";
