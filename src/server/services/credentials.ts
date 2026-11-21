import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/components/credentials/credential-list";

/** Stored logins the signed-in person may see (RLS), without passwords. `projectId` narrows to one project. */
export async function listCredentials(orgId: string, projectId?: string) {
  const supabase = await createClient();
  let q = supabase.from("credentials")
    .select("id, name, category, address, username, secret_id, project_id, device_id, notes, updated_at, projects(name), site_devices(name)")
    .eq("organization_id", orgId).is("archived_at", null).order("name").limit(2000);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  type Raw = { id: string; name: string; category: string; address: string | null; username: string | null; secret_id: string | null; project_id: string | null; device_id: string | null; notes: string | null; updated_at: string; projects: { name: string } | null; site_devices: { name: string } | null };
  return ((data ?? []) as unknown as Raw[]).map<CredentialRow>((r) => ({
    id: r.id, name: r.name, category: r.category, address: r.address, username: r.username, has_password: Boolean(r.secret_id),
    project_id: r.project_id, project_name: r.projects?.name ?? null, device_id: r.device_id, device_name: r.site_devices?.name ?? null,
    notes: r.notes, updated_at: r.updated_at,
  }));
}

export type CredentialEvent = { at: string; action: string; name: string; who: string };

/** Recent activity (added, changed, shown, removed) for people who manage logins. */
export async function credentialActivity(orgId: string, ids?: string[]) {
  const supabase = await createClient();
  let q = supabase.from("credential_events").select("at, action, user_id, credentials(name)").eq("organization_id", orgId).order("at", { ascending: false }).limit(40);
  if (ids) { if (!ids.length) return []; q = q.in("credential_id", ids.slice(0, 500)); }
  const { data } = await q;
  const rows = (data ?? []) as unknown as { at: string; action: string; user_id: string | null; credentials: { name: string } | null }[];
  const people = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = people.length ? await supabase.from("profiles").select("id, display_name").in("id", people) : { data: [] };
  const names = new Map(((profiles ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return rows.map<CredentialEvent>((r) => ({ at: r.at, action: r.action, name: r.credentials?.name ?? "", who: r.user_id ? names.get(r.user_id) ?? "Someone" : "System" }));
}
