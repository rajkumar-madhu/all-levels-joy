import { createFileRoute } from "@tanstack/react-router";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";
import { alertMarker, parseAlertPayload, severityToImpact, ALERT_SOURCE_LABELS, type NormalizedAlert } from "@/lib/monitoring-alerts";

// Prometheus Alertmanager / Grafana / generic webhooks.
// Auth: header "Authorization: Bearer <MONITORING_WEBHOOK_TOKEN>".
async function verify(request: Request, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function notifyChat(alert: NormalizedAlert, number: string) {
  const text = `🚨 ${number} — ${alert.name} (${alert.severity}) from ${ALERT_SOURCE_LABELS[alert.source]}${alert.instance ? ` on ${alert.instance}` : ""}. https://all-levels-joy.lovable.app/incidents`;
  const targets = [process.env["SLACK_WEBHOOK_URL"], process.env["TEAMS_WEBHOOK_URL"]].filter(Boolean) as string[];
  await Promise.all(
    targets.map((url) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => undefined),
    ),
  );
}

export const Route = createFileRoute("/api/public/alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["MONITORING_WEBHOOK_TOKEN"];
        if (!secret) return new Response("Alert intake is not configured", { status: 503 });
        if (!(await verify(request, secret))) return new Response("Unauthorized", { status: 401 });
        const body = await request.text();
        if (body.length > 512_000) return new Response("Payload too large", { status: 413 });
        let json: unknown;
        try { json = JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 400 }); }
        const alerts = parseAlertPayload(json);
        if (!alerts) return Response.json({ error: "Unrecognised alert payload" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const results: { alert: string; status: string; number?: string; action: string }[] = [];
        for (const alert of alerts) {
          const marker = alertMarker(alert);
          const { data: existing } = await supabaseAdmin
            .from("incidents")
            .select("id,number,description,state")
            .eq("organization_id", DEMO_ORG_ID)
            .eq("contact_type", "monitoring")
            .not("state", "in", "(resolved,closed,cancelled)")
            .ilike("description", `%${marker}%`)
            .limit(1)
            .maybeSingle();

          if (alert.status === "resolved") {
            if (existing) {
              await supabaseAdmin.from("incidents").update({
                description: `${existing.description}\n\nAlert cleared by ${ALERT_SOURCE_LABELS[alert.source]} at ${new Date().toISOString()}.`,
              }).eq("id", existing.id);
              results.push({ alert: alert.name, status: "resolved", number: existing.number, action: "noted" });
            } else results.push({ alert: alert.name, status: "resolved", action: "ignored" });
            continue;
          }
          if (existing) {
            results.push({ alert: alert.name, status: "firing", number: existing.number, action: "deduplicated" });
            continue;
          }

          let serviceId: string | null = null;
          if (alert.instance) {
            const host = alert.instance.split(":")[0];
            const { data: ci } = await supabaseAdmin
              .from("configuration_items").select("service_id")
              .eq("organization_id", DEMO_ORG_ID)
              .or(`name.eq.${host},ip_address.eq.${host}`).limit(1).maybeSingle();
            serviceId = ci?.service_id ?? null;
          }
          const { data: number, error: numErr } = await supabaseAdmin.rpc("next_record_number", { _org_id: DEMO_ORG_ID, _prefix: "INC" });
          if (numErr || !number) { results.push({ alert: alert.name, status: "firing", action: "failed" }); continue; }
          const { impact, urgency } = severityToImpact(alert.severity);
          const hours = impact + urgency <= 2 ? 2 : impact + urgency <= 4 ? 8 : 24;
          const description = [
            alert.summary || "Raised automatically from monitoring.",
            `Source: ${ALERT_SOURCE_LABELS[alert.source]}`,
            `Severity: ${alert.severity}`,
            alert.instance ? `Instance: ${alert.instance}` : null,
            alert.service ? `Service/job: ${alert.service}` : null,
            alert.link ? `Link: ${alert.link}` : null,
            marker,
          ].filter(Boolean).join("\n");
          const { error } = await supabaseAdmin.from("incidents").insert({
            organization_id: DEMO_ORG_ID,
            number: number as string,
            title: `[${alert.severity.toUpperCase()}] ${alert.name}${alert.instance ? ` — ${alert.instance}` : ""}`.slice(0, 200),
            description,
            category: "network",
            contact_type: "monitoring",
            impact,
            urgency,
            service_id: serviceId,
            sla_due_at: new Date(Date.now() + hours * 3600_000).toISOString(),
          });
          if (error) { console.error("alert incident failed", error.code); results.push({ alert: alert.name, status: "firing", action: "failed" }); continue; }
          if (impact === 1) await notifyChat(alert, number as string);
          results.push({ alert: alert.name, status: "firing", number: number as string, action: "created" });
        }
        return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
