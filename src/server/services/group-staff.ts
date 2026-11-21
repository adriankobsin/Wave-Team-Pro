import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getMyOrganizations } from "@/lib/auth/session";
import { listPeople } from "@/server/services/people";
import { countryName } from "@/lib/regions";

export type StaffCompany = {
  orgId: string;
  orgName: string;
  slug: string;
  location: string;
  membershipId: string | null; // null = invitation not accepted yet
  status: "active" | "suspended" | "deactivated" | "invited";
  roles: string[];
  jobTitle: string | null;
  department: string | null;
  teams: string[];
  invitation?: { id: string; expired: boolean; expiresAt: string; canInvite: boolean };
};

export type StaffPerson = { key: string; userId: string | null; name: string; email: string | null; avatarUrl: string | null; companies: StaffCompany[] };

const cityOf = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

/**
 * Everyone in every company where the viewer may see the staff list (users.view, users.edit
 * or roles.manage), with their status, roles, department/team and company location.
 * Pending invitations are included where the viewer may invite.
 */
/** Companies where the viewer manages staff (edit people or roles), with whether they may invite there. */
export async function staffCompanies() {
  const supabase = await createClient();
  const mine = (await getMyOrganizations()).filter((o) => o.membership_status === "active" && o.organization_status === "active");
  const checks = await Promise.all(mine.map(async (o) => {
    const [v, e, r, i] = await Promise.all(["users.view", "users.edit", "roles.manage", "users.invite"].map((k) => supabase.rpc("has_permission", { p_org: o.organization_id, p_permission: k })));
    return { see: v.data === true || e.data === true || r.data === true, manage: e.data === true || r.data === true, invite: i.data === true };
  }));
  return { mine, checks };
}

export async function listGroupStaff(): Promise<{ people: StaffPerson[]; companies: { id: string; name: string; slug: string; location: string }[] }> {
  const supabase = await createClient();
  const { mine, checks } = await staffCompanies();
  const orgs = mine.filter((_, i) => checks[i].see);
  const { data: info } = await supabase.from("organizations").select("id, timezone, country").in("id", orgs.map((o) => o.organization_id));
  const where = new Map((info ?? []).map((o) => [o.id, `${cityOf(o.timezone as string)}, ${countryName(o.country as string)}`]));

  const byKey = new Map<string, StaffPerson>();
  const companies = orgs.map((o) => ({ id: o.organization_id, name: o.name, slug: o.slug, location: where.get(o.organization_id) ?? "" })).sort((a, b) => a.name.localeCompare(b.name));
  for (const o of orgs) {
    const idx = mine.indexOf(o);
    const [people, { data: invites }, { data: roles }] = await Promise.all([
      listPeople(o.organization_id, { includeInactive: true, showEmail: true }),
      checks[idx].invite
        ? supabase.from("invitations").select("id, email, display_name, role_id, job_title, expires_at").eq("organization_id", o.organization_id).eq("status", "pending")
        : Promise.resolve({ data: [] as { id: string; email: string; display_name: string | null; role_id: string; job_title: string | null; expires_at: string }[] }),
      supabase.from("roles").select("id, name").eq("organization_id", o.organization_id),
    ]);
    const roleName = new Map((roles ?? []).map((r) => [r.id, r.name as string]));
    const base = { orgId: o.organization_id, orgName: o.name, slug: o.slug, location: where.get(o.organization_id) ?? "" };
    for (const p of people) {
      const key = p.email?.toLowerCase() ?? p.userId;
      const row = byKey.get(key) ?? { key, userId: p.userId, name: p.name, email: p.email, avatarUrl: p.avatarUrl, companies: [] };
      row.userId ??= p.userId;
      row.companies.push({
        ...base, membershipId: p.membershipId, status: p.status, roles: p.roles.map((r) => (r.scopeType === "team" ? `${r.name} (team)` : r.name)),
        jobTitle: p.jobTitle, department: p.departmentName, teams: p.teams.map((t) => t.name),
      });
      byKey.set(key, row);
    }
    for (const inv of (invites ?? []) as { id: string; email: string; display_name: string | null; role_id: string; job_title: string | null; expires_at: string }[]) {
      const key = inv.email.toLowerCase();
      const row = byKey.get(key) ?? { key, userId: null, name: inv.display_name ?? inv.email, email: inv.email, avatarUrl: null, companies: [] };
      if (row.companies.some((c) => c.orgId === o.organization_id)) continue;
      row.companies.push({ ...base, membershipId: null, status: "invited", roles: [roleName.get(inv.role_id) ?? "Role"], jobTitle: inv.job_title, department: null, teams: [],
        invitation: { id: inv.id, expiresAt: inv.expires_at, expired: new Date(inv.expires_at) <= new Date(), canInvite: true } });
      byKey.set(key, row);
    }
  }
  const people = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of people) p.companies.sort((a, b) => a.orgName.localeCompare(b.orgName));
  return { people, companies };
}
