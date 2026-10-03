import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/security-exceptions-expire")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("itsm_expire_security_exceptions");
        if (error) {
          console.error("expire exceptions failed", error.message);
          return new Response("Failed", { status: 500 });
        }
        return Response.json({ expired: data });
      },
    },
  },
});
