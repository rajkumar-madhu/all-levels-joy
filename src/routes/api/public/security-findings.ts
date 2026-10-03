import { createFileRoute } from "@tanstack/react-router";
import { scannerPayloadSchema } from "@/lib/security-workflow";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

// Scanners POST signed JSON: header x-wecrew-signature = hex HMAC-SHA256(body, SECURITY_SCANNER_SECRET).
export const Route = createFileRoute("/api/public/security-findings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["SECURITY_SCANNER_SECRET"];
        if (!secret) return new Response("Scanner intake is not configured", { status: 503 });
        const body = await request.text();
        if (body.length > 512_000) return new Response("Payload too large", { status: 413 });
        const signature = (request.headers.get("x-wecrew-signature") ?? "").replace(/^sha256=/, "");
        const { createHmac, timingSafeEqual } = await import("node:crypto");
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature, "utf8");
        const b = Buffer.from(expected, "utf8");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = scannerPayloadSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const results: { reference: string; number?: string; created?: boolean; error?: string }[] = [];
        for (const finding of parsed.data.findings) {
          const { data, error } = await supabaseAdmin.rpc("itsm_upsert_scanner_finding", {
            _org_id: DEMO_ORG_ID,
            _input: finding,
          });
          if (error) {
            console.error("scanner finding failed", finding.reference, error.message);
            results.push({ reference: finding.reference, error: "Not saved" });
          } else {
            const r = data as { number: string; created: boolean };
            results.push({ reference: finding.reference, number: r.number, created: r.created });
          }
        }
        return Response.json({ results });
      },
    },
  },
});
