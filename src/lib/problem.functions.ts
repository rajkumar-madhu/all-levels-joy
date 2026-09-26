import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

import { DEMO_ORG_ID, type AppRole } from "@/lib/itsm-shared";
import type { Database } from "@/integrations/supabase/types";
import { nextRecordNumber } from "@/lib/record-number";

type ProblemUpdate = Database["public"]["Tables"]["problems"]["Update"];
type MajorIncidentUpdate = Database["public"]["Tables"]["major_incidents"]["Update"];

const uuid = z.string().uuid();

const RECORD_STATE = z.enum([
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
  "cancelled",
]);

const BRIDGE_STATE = z.enum(["declared", "investigating", "mitigating", "monitoring", "resolved"]);

async function writeAudit(
  supabase: any,
  actorId: string,
  recordType: string,
  recordId: string | null,
  action: string,
  after?: Record<string, unknown>,
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

async function loadRoles(supabase: any, userId: string): Promise<AppRole[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("organization_id", DEMO_ORG_ID)
    .eq("user_id", userId);
  return (data ?? []).map((row: { role: AppRole }) => row.role);
}

const PROBLEM_ROLES: AppRole[] = ["service_desk", "fulfiller", "manager", "admin", "change_manager"];

async function requireProblemRole(supabase: any, userId: string) {
  const roles = await loadRoles(supabase, userId);
  if (!roles.some((role) => PROBLEM_ROLES.includes(role))) {
    throw new Error("You do not have permission to manage problems or major incidents.");
  }
  return roles;
}

function notify(supabase: any, userIds: string[], title: string, body: string, recordId: string) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return Promise.resolve();
  return supabase.from("notifications").insert(
    unique.map((userId) => ({
      organization_id: DEMO_ORG_ID,
      user_id: userId,
      title,
      body,
      record_type: "major_incident",
      record_id: recordId,
    })),
  );
}

/* ---------------------------------- reads --------------------------------- */

export const getProblemBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [problems, links, incidents, services, profiles] = await Promise.all([
      supabase
        .from("problems")
        .select(
          "id, number, title, description, state, impact, urgency, priority, category, service_id, assignee_id, known_error, workaround, root_cause, fix_plan, resolution_notes, resolved_at, created_at, updated_at",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false }),
      supabase
        .from("problem_incidents")
        .select("id, problem_id, incident_id, created_at")
        .eq("organization_id", DEMO_ORG_ID),
      supabase
        .from("incidents")
        .select(
          "id, number, title, state, priority, impact, urgency, category, service_id, major_incident, problem_id, sla_due_at, resolved_at, created_at",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("services").select("id, name").eq("organization_id", DEMO_ORG_ID),
      supabase.from("profiles").select("id, display_name"),
    ]);

    const roles = await loadRoles(supabase, userId);

    return {
      problems: problems.data ?? [],
      links: links.data ?? [],
      incidents: incidents.data ?? [],
      services: services.data ?? [],
      profiles: profiles.data ?? [],
      roles,
      userId,
    };
  });

export const getCommandCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [majors, updates, incidents, problems, profiles] = await Promise.all([
      supabase
        .from("major_incidents")
        .select(
          "id, number, incident_id, problem_id, severity, bridge_state, commander_id, comms_lead_id, bridge_url, situation_summary, customer_impact, escalation_level, declared_at, mitigated_at, resolved_at, next_update_at",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .order("declared_at", { ascending: false }),
      supabase
        .from("major_incident_updates")
        .select("id, major_incident_id, author_id, update_type, body, audience, created_at")
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("incidents")
        .select(
          "id, number, title, state, priority, impact, urgency, service_id, major_incident, problem_id, sla_due_at, resolved_at, created_at",
        )
        .eq("organization_id", DEMO_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("problems")
        .select("id, number, title, state")
        .eq("organization_id", DEMO_ORG_ID),
      supabase.from("profiles").select("id, display_name"),
    ]);

    const roles = await loadRoles(supabase, userId);

    return {
      majors: majors.data ?? [],
      updates: updates.data ?? [],
      incidents: incidents.data ?? [],
      problems: problems.data ?? [],
      profiles: profiles.data ?? [],
      roles,
      userId,
    };
  });

/* -------------------------------- problems -------------------------------- */

export const createProblem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      title: string;
      description: string;
      impact: number;
      urgency: number;
      category?: string | null;
      serviceId?: string | null;
      fromIncidentId?: string | null;
      assignToMe?: boolean;
    }) =>
      z
        .object({
          title: z.string().trim().min(5).max(160),
          description: z.string().trim().min(5).max(6000),
          impact: z.number().int().min(1).max(3),
          urgency: z.number().int().min(1).max(3),
          category: z.string().trim().max(40).nullish(),
          serviceId: uuid.nullish(),
          fromIncidentId: uuid.nullish(),
          assignToMe: z.boolean().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProblemRole(supabase, userId);

    const number = await nextRecordNumber(supabase, DEMO_ORG_ID, "PRB");
    const { data: problem, error } = await supabase
      .from("problems")
      .insert({
        organization_id: DEMO_ORG_ID,
        number,
        title: data.title,
        description: data.description,
        impact: data.impact,
        urgency: data.urgency,
        priority: Math.min(5, data.impact + data.urgency - 1),
        category: data.category || null,
        service_id: data.serviceId ?? null,
        opened_by: userId,
        assignee_id: data.assignToMe ? userId : null,
        state: "new",
      })
      .select("id, number")
      .single();
    if (error) throw new Error(error.message);

    if (data.fromIncidentId) {
      await supabase.from("problem_incidents").insert({
        organization_id: DEMO_ORG_ID,
        problem_id: problem.id,
        incident_id: data.fromIncidentId,
        linked_by: userId,
      });
      await supabase
        .from("incidents")
        .update({ problem_id: problem.id })
        .eq("id", data.fromIncidentId);
      await writeAudit(supabase, userId, "incident", data.fromIncidentId, "problem_linked", {
        problem: problem.number,
      });
    }

    await writeAudit(supabase, userId, "problem", problem.id, "created", { number });
    return problem;
  });

export const updateProblem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      state?: string;
      assignToMe?: boolean;
      knownError?: boolean;
      workaround?: string | null;
      rootCause?: string | null;
      fixPlan?: string | null;
      resolutionNotes?: string | null;
      impact?: number;
      urgency?: number;
    }) =>
      z
        .object({
          id: uuid,
          state: RECORD_STATE.optional(),
          assignToMe: z.boolean().optional(),
          knownError: z.boolean().optional(),
          workaround: z.string().trim().max(4000).nullish(),
          rootCause: z.string().trim().max(4000).nullish(),
          fixPlan: z.string().trim().max(4000).nullish(),
          resolutionNotes: z.string().trim().max(4000).nullish(),
          impact: z.number().int().min(1).max(3).optional(),
          urgency: z.number().int().min(1).max(3).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProblemRole(supabase, userId);

    const patch: ProblemUpdate = {};
    if (data.state) patch["state"] = data.state;
    if (data.assignToMe) patch["assignee_id"] = userId;
    if (data.knownError !== undefined) patch["known_error"] = data.knownError;
    if (data.workaround !== undefined) patch["workaround"] = data.workaround || null;
    if (data.rootCause !== undefined) patch["root_cause"] = data.rootCause || null;
    if (data.fixPlan !== undefined) patch["fix_plan"] = data.fixPlan || null;
    if (data.resolutionNotes !== undefined) patch["resolution_notes"] = data.resolutionNotes || null;
    if (data.impact) patch["impact"] = data.impact;
    if (data.urgency) patch["urgency"] = data.urgency;
    if (data.impact || data.urgency) {
      const { data: current } = await supabase
        .from("problems")
        .select("impact, urgency")
        .eq("id", data.id)
        .maybeSingle();
      const impact = data.impact ?? current?.impact ?? 2;
      const urgency = data.urgency ?? current?.urgency ?? 2;
      patch["priority"] = Math.min(5, impact + urgency - 1);
    }

    if (data.state === "resolved" || data.state === "closed") {
      const { data: current } = await supabase
        .from("problems")
        .select("root_cause, resolution_notes")
        .eq("id", data.id)
        .maybeSingle();
      const rootCause = data.rootCause ?? current?.root_cause;
      const notes = data.resolutionNotes ?? current?.resolution_notes;
      if (!rootCause || !notes) {
        throw new Error("Record the root cause and resolution notes before closing a problem.");
      }
      patch["resolved_at"] = new Date().toISOString();
    } else if (data.state) {
      patch["resolved_at"] = null;
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabase.from("problems").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(supabase, userId, "problem", data.id, "updated", patch);
    return { ok: true };
  });

export const linkIncidentToProblem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { problemId: string; incidentId: string; linked: boolean }) =>
    z.object({ problemId: uuid, incidentId: uuid, linked: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProblemRole(supabase, userId);

    if (data.linked) {
      const { error } = await supabase.from("problem_incidents").insert({
        organization_id: DEMO_ORG_ID,
        problem_id: data.problemId,
        incident_id: data.incidentId,
        linked_by: userId,
      });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
      await supabase
        .from("incidents")
        .update({ problem_id: data.problemId })
        .eq("id", data.incidentId);
      await writeAudit(supabase, userId, "incident", data.incidentId, "problem_linked");
    } else {
      const { error } = await supabase
        .from("problem_incidents")
        .delete()
        .eq("problem_id", data.problemId)
        .eq("incident_id", data.incidentId);
      if (error) throw new Error(error.message);
      await supabase.from("incidents").update({ problem_id: null }).eq("id", data.incidentId);
      await writeAudit(supabase, userId, "incident", data.incidentId, "problem_unlinked");
    }
    return { ok: true };
  });

/* ---------------------------- major incidents ----------------------------- */

export const declareMajorIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      incidentId: string;
      severity: number;
      situationSummary: string;
      customerImpact?: string | null;
      bridgeUrl?: string | null;
      takeCommand?: boolean;
      nextUpdateMinutes?: number;
    }) =>
      z
        .object({
          incidentId: uuid,
          severity: z.number().int().min(1).max(3),
          situationSummary: z.string().trim().min(10).max(4000),
          customerImpact: z.string().trim().max(2000).nullish(),
          bridgeUrl: z.string().trim().max(500).nullish(),
          takeCommand: z.boolean().optional(),
          nextUpdateMinutes: z.number().int().min(5).max(480).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProblemRole(supabase, userId);

    const { data: existing } = await supabase
      .from("major_incidents")
      .select("id, number")
      .eq("incident_id", data.incidentId)
      .maybeSingle();
    if (existing) {
      throw new Error(`This incident is already under major incident command (${existing.number}).`);
    }

    const number = await nextRecordNumber(supabase, DEMO_ORG_ID, "MI");
    const cadence = data.nextUpdateMinutes ?? 30;

    const { data: major, error } = await supabase
      .from("major_incidents")
      .insert({
        organization_id: DEMO_ORG_ID,
        number,
        incident_id: data.incidentId,
        severity: data.severity,
        bridge_state: "declared",
        commander_id: data.takeCommand === false ? null : userId,
        bridge_url: data.bridgeUrl || null,
        situation_summary: data.situationSummary,
        customer_impact: data.customerImpact || null,
        escalation_level: data.severity === 1 ? 3 : data.severity === 2 ? 2 : 1,
        declared_by: userId,
        next_update_at: new Date(Date.now() + cadence * 60_000).toISOString(),
      })
      .select("id, number")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("major_incident_updates").insert({
      organization_id: DEMO_ORG_ID,
      major_incident_id: major.id,
      author_id: userId,
      update_type: "declaration",
      audience: "internal",
      body: data.situationSummary,
    });

    const { error: incidentUpdateError } = await supabase
      .from("incidents")
      .update({ major_incident: true, impact: 1, urgency: 1, priority: 1, state: "in_progress" })
      .eq("id", data.incidentId);
    if (incidentUpdateError) throw new Error(incidentUpdateError.message);

    const { data: managers } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("organization_id", DEMO_ORG_ID)
      .in("role", ["manager", "admin", "service_desk", "change_manager"]);

    await notify(
      supabase,
      (managers ?? []).map((row: { user_id: string }) => row.user_id),
      `${number} declared — severity ${data.severity}`,
      data.situationSummary.slice(0, 280),
      major.id,
    );

    await writeAudit(supabase, userId, "major_incident", major.id, "declared", {
      number,
      severity: data.severity,
    });
    await writeAudit(supabase, userId, "incident", data.incidentId, "major_incident_declared", {
      number,
    });

    return major;
  });

export const updateMajorIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      bridgeState?: string;
      escalationLevel?: number;
      severity?: number;
      situationSummary?: string | null;
      customerImpact?: string | null;
      bridgeUrl?: string | null;
      takeCommand?: boolean;
      takeComms?: boolean;
      nextUpdateMinutes?: number;
      problemId?: string | null;
    }) =>
      z
        .object({
          id: uuid,
          bridgeState: BRIDGE_STATE.optional(),
          escalationLevel: z.number().int().min(1).max(4).optional(),
          severity: z.number().int().min(1).max(3).optional(),
          situationSummary: z.string().trim().max(4000).nullish(),
          customerImpact: z.string().trim().max(2000).nullish(),
          bridgeUrl: z.string().trim().max(500).nullish(),
          takeCommand: z.boolean().optional(),
          takeComms: z.boolean().optional(),
          nextUpdateMinutes: z.number().int().min(5).max(480).optional(),
          problemId: uuid.nullish(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProblemRole(supabase, userId);

    const { data: current } = await supabase
      .from("major_incidents")
      .select("id, number, incident_id, bridge_state, problem_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("That major incident no longer exists.");

    const patch: MajorIncidentUpdate = {};
    if (data.bridgeState) patch["bridge_state"] = data.bridgeState;
    if (data.escalationLevel) patch["escalation_level"] = data.escalationLevel;
    if (data.severity) patch["severity"] = data.severity;
    if (data.situationSummary !== undefined)
      patch["situation_summary"] = data.situationSummary || null;
    if (data.customerImpact !== undefined) patch["customer_impact"] = data.customerImpact || null;
    if (data.bridgeUrl !== undefined) patch["bridge_url"] = data.bridgeUrl || null;
    if (data.takeCommand) patch["commander_id"] = userId;
    if (data.takeComms) patch["comms_lead_id"] = userId;
    if (data.problemId !== undefined) patch["problem_id"] = data.problemId || null;
    if (data.nextUpdateMinutes) {
      patch["next_update_at"] = new Date(Date.now() + data.nextUpdateMinutes * 60_000).toISOString();
    }
    if (data.bridgeState === "mitigating") patch["mitigated_at"] = new Date().toISOString();
    if (data.bridgeState === "resolved") {
      patch["resolved_at"] = new Date().toISOString();
      patch["next_update_at"] = null;
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabase.from("major_incidents").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    if (data.problemId !== undefined) {
      const linkedProblemId = data.problemId || null;
      const { error: incidentLinkError } = await supabase
        .from("incidents")
        .update({ problem_id: linkedProblemId })
        .eq("id", current.incident_id);
      if (incidentLinkError) throw new Error(incidentLinkError.message);

      if (current.problem_id && current.problem_id !== linkedProblemId) {
        const { error: unlinkError } = await supabase
          .from("problem_incidents")
          .delete()
          .eq("problem_id", current.problem_id)
          .eq("incident_id", current.incident_id);
        if (unlinkError) throw new Error(unlinkError.message);
      }

      if (linkedProblemId) {
        const { error: linkError } = await supabase.from("problem_incidents").upsert(
          {
            organization_id: DEMO_ORG_ID,
            problem_id: linkedProblemId,
            incident_id: current.incident_id,
            linked_by: userId,
          },
          { onConflict: "problem_id,incident_id" },
        );
        if (linkError) throw new Error(linkError.message);
      }
    }

    if (data.bridgeState === "resolved") {
      const { error: resolveError } = await supabase
        .from("incidents")
        .update({
          state: "resolved",
          resolved_at: new Date().toISOString(),
          major_incident: true,
          problem_id: data.problemId ?? current.problem_id,
        })
        .eq("id", current.incident_id)
        .in("state", ["new", "open", "in_progress", "pending"]);
      if (resolveError) throw new Error(resolveError.message);
    }

    await writeAudit(supabase, userId, "major_incident", data.id, "updated", patch);
    return { ok: true };
  });

export const postMajorIncidentUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      majorIncidentId: string;
      body: string;
      updateType?: string;
      audience?: string;
      nextUpdateMinutes?: number;
    }) =>
      z
        .object({
          majorIncidentId: uuid,
          body: z.string().trim().min(3).max(4000),
          updateType: z.enum(["status", "action", "escalation", "comms", "resolution"]).optional(),
          audience: z.enum(["internal", "customer", "executive"]).optional(),
          nextUpdateMinutes: z.number().int().min(5).max(480).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireProblemRole(supabase, userId);

    const { error } = await supabase.from("major_incident_updates").insert({
      organization_id: DEMO_ORG_ID,
      major_incident_id: data.majorIncidentId,
      author_id: userId,
      update_type: data.updateType ?? "status",
      audience: data.audience ?? "internal",
      body: data.body,
    });
    if (error) throw new Error(error.message);

    if (data.nextUpdateMinutes) {
      await supabase
        .from("major_incidents")
        .update({
          next_update_at: new Date(Date.now() + data.nextUpdateMinutes * 60_000).toISOString(),
        })
        .eq("id", data.majorIncidentId);
    }

    await writeAudit(supabase, userId, "major_incident", data.majorIncidentId, "update_posted", {
      audience: data.audience ?? "internal",
    });
    return { ok: true };
  });
