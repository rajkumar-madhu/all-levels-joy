import { z } from "zod";

export const INCIDENT_QUEUES = [
  { value: "active", label: "Active", hint: "All work awaiting resolution" },
  { value: "mine", label: "Assigned to me", hint: "Your active incidents" },
  { value: "unassigned", label: "Unassigned", hint: "Active incidents without an owner" },
  {
    value: "at_risk",
    label: "Due within 1h",
    hint: "Active resolution targets due within an hour",
  },
  { value: "breached", label: "Breached", hint: "Active incidents past their resolution target" },
  { value: "completed", label: "Resolved", hint: "Resolved and closed incidents" },
  { value: "all", label: "All records", hint: "Includes cancelled and completed work" },
] as const;

export type IncidentQueue = (typeof INCIDENT_QUEUES)[number]["value"];
export const INCIDENT_PAGE_SIZE = 25;
export const incidentQueueSchema = z.object({
  queue: z
    .enum(["active", "mine", "unassigned", "at_risk", "breached", "completed", "all"])
    .default("active"),
  q: z.string().trim().max(100).default(""),
  priority: z.enum(["all", "1", "2", "3", "4", "5"]).default("all"),
  group: z.union([z.literal("all"), z.literal("unassigned"), z.string().uuid()]).default("all"),
  service: z.union([z.literal("all"), z.string().uuid()]).default("all"),
  sort: z.enum(["sla", "priority", "newest", "oldest"]).default("sla"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export const incidentSearchSchema = incidentQueueSchema.extend({
  record: z.string().uuid().optional(),
});
export type IncidentQueueFilters = z.infer<typeof incidentQueueSchema>;

/** Quote PostgREST filter values; wildcards are not part of the user search language. */
export function incidentSearchFilter(query: string) {
  const text = query.replace(/[%_*]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const value = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `number.ilike."%${value}%",title.ilike."%${value}%"`;
}
