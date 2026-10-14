import { createFileRoute } from "@tanstack/react-router";
import { DEMO_ORG_ID } from "@/lib/itsm-shared";

const MAX_WEBHOOK_BYTES = 512_000;

async function readBoundedBody(request: Request): Promise<{ body: string } | { status: number }> {
  const reader = request.body?.getReader();
  if (!reader) return { body: "" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return { status: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: 400 };
  }
}

// PagerDuty webhook v3. Header X-PagerDuty-Signature is v1=<hex HMAC-SHA256(body, PAGERDUTY_WEBHOOK_SECRET)>.
export const Route = createFileRoute("/api/public/pagerduty")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: Boolean(process.env["PAGERDUTY_WEBHOOK_SECRET"]),
          events: ["incident.triggered", "incident.acknowledged", "incident.resolved", "incident.reopened"],
        }),
      POST: async ({ request }) => {
        const secret = process.env["PAGERDUTY_WEBHOOK_SECRET"];
        if (!secret) return new Response("PagerDuty intake is not configured", { status: 503 });
        const raw = await readBoundedBody(request);
        if ("status" in raw) {
          return new Response(raw.status === 413 ? "Payload too large" : "Invalid UTF-8 body", {
            status: raw.status,
          });
        }
        const { body } = raw;
        const header = request.headers.get("x-pagerduty-signature") ?? "";
        const { createHmac, timingSafeEqual } = await import("node:crypto");
        const expected = createHmac("sha256", secret).update(body).digest();
        const signatures = header
          .split(",")
          .map((part) => /^v1=([\da-f]{64})$/i.exec(part.trim())?.[1])
          .filter((part): part is string => Boolean(part));
        const match = signatures.some((signature) => {
          const a = Buffer.from(signature, "hex");
          return a.length === expected.length && timingSafeEqual(a, expected);
        });
        if (!match) return new Response("Invalid signature", { status: 401 });

        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (typeof json !== "object" || json === null || Array.isArray(json)) {
          return new Response("Invalid PagerDuty event", { status: 400 });
        }
        const eventValue = (json as { event?: unknown }).event;
        if (typeof eventValue !== "object" || eventValue === null || Array.isArray(eventValue)) {
          return new Response("Invalid PagerDuty event", { status: 400 });
        }
        const event = eventValue as {
          event_type?: string;
          id?: string;
          occurred_at?: string;
          data?: Record<string, unknown>;
        };
        const eventType = event.event_type ?? "";
        const eventId = typeof event.id === "string" ? event.id.trim() : "";
        if (!eventId || eventId.length > 256) {
          return Response.json({ error: "Valid PagerDuty event id is required" }, { status: 400 });
        }
        if (
          ![
            "incident.triggered",
            "incident.acknowledged",
            "incident.resolved",
            "incident.reopened",
          ].includes(eventType)
        ) {
          return Response.json({ error: "Unsupported PagerDuty event" }, { status: 400 });
        }
        const data = event.data;
        const rawId = data?.["id"];
        const id = typeof rawId === "string" ? rawId.trim() : "";
        if (!id || id.length > 256) {
          return Response.json({ error: "Valid PagerDuty incident id is required" }, { status: 400 });
        }
        if (data?.["type"] !== "incident") {
          return Response.json({ error: "PagerDuty event is not an incident" }, { status: 400 });
        }
        const rawStatus = data?.["status"];
        const incidentStatus = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
        if (!["triggered", "acknowledged", "resolved"].includes(incidentStatus)) {
          return Response.json({ error: "Invalid PagerDuty incident status" }, { status: 400 });
        }
        const expectedStatus =
          eventType === "incident.acknowledged"
            ? "acknowledged"
            : eventType === "incident.resolved"
              ? "resolved"
              : "triggered";
        if (incidentStatus !== expectedStatus) {
          return Response.json({ error: "PagerDuty event and incident status do not match" }, { status: 400 });
        }
        const occurredAt = event.occurred_at;
        if (
          !occurredAt ||
          !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(occurredAt) ||
          !Number.isFinite(Date.parse(occurredAt))
        ) {
          return Response.json({ error: "Invalid PagerDuty event timestamp" }, { status: 400 });
        }
        const service = data?.["service"] as { summary?: unknown } | undefined;
        const rawUrlValue = data?.["html_url"];
        const rawUrl = typeof rawUrlValue === "string" ? rawUrlValue : "";
        let incidentUrl = "";
        if (rawUrl) {
          try {
            const parsedUrl = new URL(rawUrl);
            if (
              parsedUrl.protocol === "https:" &&
              (parsedUrl.hostname === "pagerduty.com" || parsedUrl.hostname.endsWith(".pagerduty.com"))
            ) {
              incidentUrl = parsedUrl.toString();
            }
          } catch {
            // Invalid external links are ignored; the incident record is still useful.
          }
        }
        const input = {
          id,
          title: typeof data?.["title"] === "string" ? data["title"] : "PagerDuty incident",
          status: incidentStatus,
          urgency: typeof data?.["urgency"] === "string" ? data["urgency"] : "high",
          html_url: incidentUrl,
          service:
            typeof service?.summary === "string" ? service.summary.slice(0, 100) : "",
          event_type: eventType,
          event_id: eventId,
          occurred_at: occurredAt ?? null,
        };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: saved, error } = await supabaseAdmin.rpc("itsm_upsert_pagerduty_incident", {
          _org_id: DEMO_ORG_ID,
          _input: input,
        });
        if (error) {
          console.error("pagerduty incident failed", id, error.message);
          return Response.json({ error: "Not saved" }, { status: 500 });
        }
        return Response.json(saved);
      },
    },
  },
});
