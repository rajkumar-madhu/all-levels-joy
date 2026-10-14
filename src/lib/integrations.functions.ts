import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

// Staff-only: reports which integrations have their credentials configured (booleans only, never values).
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: allowed } = await context.supabase.rpc("can_manage", { _org_id: DEMO_ORG_ID });
    if (!allowed) throw new Error("Staff access required");
    const has = (k: string) => Boolean(process.env[k]);
    return {
      monitoring: has("MONITORING_WEBHOOK_TOKEN"),
      scanner: has("SECURITY_SCANNER_SECRET"),
      slack: has("SLACK_WEBHOOK_URL"),
      teams: has("TEAMS_WEBHOOK_URL"),
    };
  });
