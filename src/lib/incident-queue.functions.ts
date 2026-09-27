import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";
import { incidentQueueSchema } from "@/lib/incident-queue";
import {
  loadIncidentQueue,
  loadIncidentQueueCounts,
  loadIncidentRecord,
} from "@/lib/incident-queue.server";

export const getIncidentQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(incidentQueueSchema)
  .handler(({ data, context }) =>
    loadIncidentQueue(context.supabase, DEMO_ORG_ID, context.userId, data),
  );

export const getIncidentQueueCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => loadIncidentQueueCounts(context.supabase, DEMO_ORG_ID, context.userId));

export const getIncidentRecord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(({ data, context }) => loadIncidentRecord(context.supabase, DEMO_ORG_ID, data.id));
