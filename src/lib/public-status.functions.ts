import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PublicService } from "@/lib/service-status";

export const getPublicServiceStatus = createServerFn({ method: "GET" }).handler(async () => {
  const unavailable = {
    available: false,
    services: [] as PublicService[],
    fetchedAt: null as string | null,
  };
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return unavailable;
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers, signal: AbortSignal.timeout(10_000) });
      },
    },
  });
  try {
    const { data, error } = await client.rpc("itsm_public_service_status");
    if (error) return unavailable;
    return { available: true, services: data ?? [], fetchedAt: new Date().toISOString() };
  } catch {
    return unavailable;
  }
});
