import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyOrganizations } from "@/lib/auth/session";

export type Company = { id: string; name: string; slug: string };

/** Companies the signed-in person may invite people into (active member with users.invite). */
export async function invitableCompanies(): Promise<Company[]> {
  const supabase = await createClient();
  const orgs = (await getMyOrganizations()).filter((o) => o.membership_status === "active" && o.organization_status === "active");
  const checks = await Promise.all(orgs.map((o) => supabase.rpc("has_permission", { p_org: o.organization_id, p_permission: "users.invite" })));
  return orgs
    .filter((_, i) => checks[i].data === true)
    .map((o) => ({ id: o.organization_id, name: o.name, slug: o.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PersonDetails = {
  email: string;
  display_name: string | null;
  job_title: string | null;
  start_date?: string | null;
  employee_number?: string | null;
};

/**
 * Creates invitations for the same person in other companies, with the same role (matched by
 * its key, e.g. "employee", "hr_manager"; Employee when that company has no such role).
 * Row-level security re-checks the inviter's permission in each company.
 */
export async function inviteToCompanies(supabase: SupabaseClient, person: PersonDetails, roleKey: string, companies: Company[]) {
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const c of companies) {
    const { data: roles } = await supabase.from("roles").select("id, key").eq("organization_id", c.id).in("key", [roleKey, "employee"]);
    const role = roles?.find((r) => r.key === roleKey) ?? roles?.find((r) => r.key === "employee");
    if (!role) {
      skipped.push({ name: c.name, reason: "no matching role" });
      continue;
    }
    const { error } = await supabase.from("invitations").insert({
      organization_id: c.id,
      email: person.email,
      display_name: person.display_name,
      role_id: role.id,
      job_title: person.job_title,
      start_date: person.start_date ?? null,
      employee_number: person.employee_number ?? null,
      expires_at: new Date().toISOString(), // the database sets the real expiry
    });
    if (!error) added.push(c.name);
    else skipped.push({ name: c.name, reason: error.code === "23505" ? "already invited" : error.code === "42501" ? "you can't invite there" : "couldn't create the invitation" });
  }
  return { added, skipped };
}

export function summarise(r: { added: string[]; skipped: { name: string; reason: string }[] }) {
  const parts: string[] = [];
  if (r.added.length) parts.push(`Also added to ${r.added.join(", ")}: the same link joins every company.`);
  if (r.skipped.length) parts.push(`Not added to ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.`);
  return parts.join(" ");
}
