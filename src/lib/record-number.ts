import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type RecordPrefix = "INC" | "REQ" | "CHG" | "KB" | "PRB" | "MI";

export async function nextRecordNumber(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  prefix: RecordPrefix,
) {
  const { data, error } = await supabase.rpc("next_record_number", {
    _org_id: organizationId,
    _prefix: prefix,
  });

  if (error) throw new Error(error.message);
  return data;
}
