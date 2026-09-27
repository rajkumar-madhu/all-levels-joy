import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  INCIDENT_PAGE_SIZE,
  INCIDENT_QUEUES,
  incidentSearchFilter,
  type IncidentQueue,
  type IncidentQueueFilters,
} from "@/lib/incident-queue";

type Client = SupabaseClient<Database>;
const activeStates = ["new", "open", "in_progress", "pending"] as const;

function queueQuery(
  client: Client,
  organizationId: string,
  userId: string,
  queue: IncidentQueue,
  now: Date,
  head = false,
) {
  let query = client
    .from("incidents")
    .select("*", { count: "exact", head })
    .eq("organization_id", organizationId);
  if (queue !== "all" && queue !== "completed") query = query.in("state", [...activeStates]);
  if (queue === "mine") query = query.eq("assignee_id", userId);
  if (queue === "unassigned") query = query.is("assignee_id", null);
  if (queue === "completed") query = query.in("state", ["resolved", "closed"]);
  if (queue === "breached") query = query.lt("sla_due_at", now.toISOString());
  if (queue === "at_risk")
    query = query
      .gte("sla_due_at", now.toISOString())
      .lte("sla_due_at", new Date(now.getTime() + 3600000).toISOString());
  return query;
}

export async function loadIncidentQueue(
  client: Client,
  organizationId: string,
  userId: string,
  filters: IncidentQueueFilters,
  now = new Date(),
) {
  let query = queueQuery(client, organizationId, userId, filters.queue, now);
  const match = incidentSearchFilter(filters.q);
  if (match) query = query.or(match);
  if (filters.priority !== "all") query = query.eq("priority", Number(filters.priority));
  if (filters.group === "unassigned") query = query.is("group_id", null);
  else if (filters.group !== "all") query = query.eq("group_id", filters.group);
  if (filters.service !== "all") query = query.eq("service_id", filters.service);
  if (filters.sort === "sla")
    query = query.order("sla_due_at", { ascending: true, nullsFirst: false }).order("priority");
  if (filters.sort === "priority")
    query = query.order("priority").order("sla_due_at", { ascending: true, nullsFirst: false });
  query = query.order("created_at", { ascending: filters.sort === "oldest" }).order("id");
  const from = (filters.page - 1) * INCIDENT_PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + INCIDENT_PAGE_SIZE - 1);
  if (error) throw new Error("The incident queue could not be loaded. Please retry.");
  if (count === null || data === null)
    throw new Error("The incident queue returned incomplete data. Please retry.");
  return {
    incidents: data,
    total: count,
    page: filters.page,
    pageSize: INCIDENT_PAGE_SIZE,
    fetchedAt: now.toISOString(),
  };
}

/** Counts cover the visible workspace; secondary list filters never change queue totals. */
export async function loadIncidentQueueCounts(
  client: Client,
  organizationId: string,
  userId: string,
  now = new Date(),
) {
  const entries = await Promise.all(
    INCIDENT_QUEUES.map(async ({ value }) => {
      const { count, error } = await queueQuery(client, organizationId, userId, value, now, true);
      if (error || count === null) throw new Error("Queue totals are unavailable. Please retry.");
      return [value, count] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<IncidentQueue, number>;
}

export async function loadIncidentRecord(client: Client, organizationId: string, id: string) {
  const { data, error } = await client
    .from("incidents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("The incident could not be loaded. Please retry.");
  return data;
}
