import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectZones } from "@/lib/time";

/** Project id → its time zone. Projects without a zone are left out (callers fall back to the company). */
export async function projectZones(client: SupabaseClient, ids: (string | null | undefined)[]): Promise<ProjectZones> {
  const list = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (!list.length) return new Map();
  const { data } = await client.from("projects").select("id, timezone").in("id", list);
  return new Map((data ?? []).filter((p) => p.timezone).map((p) => [p.id as string, p.timezone as string]));
}
