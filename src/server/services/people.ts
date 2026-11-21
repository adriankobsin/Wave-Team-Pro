import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { signAvatarPaths } from "./avatars";

export type DirectoryPerson = {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  employeeNumber: string | null;
  status: "active" | "suspended" | "deactivated";
  departmentId: string | null;
  departmentName: string | null;
  managerMembershipId: string | null;
  managerName: string | null;
  teams: { id: string; name: string; isLead: boolean }[];
  roles: { id: string; name: string; scopeType: string; scopeId: string | null }[];
  timezone: string;
  startDate: string | null;
  avatarUrl: string | null;
  avatarFullUrl: string | null;
};

export type OrgStructure = {
  departments: { id: string; name: string; code: string | null }[];
  teams: { id: string; name: string; department_id: string | null; description: string | null }[];
};

export async function getStructure(orgId: string, client?: SupabaseClient): Promise<OrgStructure> {
  const supabase = client ?? (await createClient());
  const [{ data: departments }, { data: teams }] = await Promise.all([
    supabase.from("departments").select("id, name, code").eq("organization_id", orgId).is("archived_at", null).order("name"),
    supabase
      .from("teams")
      .select("id, name, department_id, description")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("name"),
  ]);
  return { departments: departments ?? [], teams: teams ?? [] };
}

/**
 * Directory for one organization. RLS restricts every query to organizations the viewer
 * actively belongs to. Joined in application code to keep each query simple and indexed.
 */
export async function listPeople(
  orgId: string,
  opts: { includeInactive?: boolean; withFullAvatars?: boolean; showEmail?: boolean } = {},
  client?: SupabaseClient,
): Promise<DirectoryPerson[]> {
  const supabase = client ?? (await createClient());
  let mq = supabase
    .from("organization_memberships")
    .select("id, user_id, job_title, employee_number, status, department_id, manager_membership_id, start_date")
    .eq("organization_id", orgId);
  if (!opts.includeInactive) mq = mq.eq("status", "active");
  const { data: memberships, error } = await mq;
  if (error) throw error;
  const rows = memberships ?? [];
  if (rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);
  const [{ data: profiles }, structure, { data: teamLinks }, { data: assignments }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, email_display, avatar_thumb_path, avatar_path, timezone")
      .in("id", userIds),
    getStructure(orgId, client),
    supabase.from("team_memberships").select("team_id, membership_id, is_lead").eq("organization_id", orgId),
    supabase.from("membership_role_assignments").select("membership_id, role_id, scope_type, scope_id").eq("organization_id", orgId),
    supabase.from("roles").select("id, name").eq("organization_id", orgId),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const deptById = new Map(structure.departments.map((d) => [d.id, d.name]));
  const teamById = new Map(structure.teams.map((t) => [t.id, t.name]));
  const roleById = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const nameByMembership = new Map(rows.map((r) => [r.id, profileById.get(r.user_id)?.display_name ?? "Unknown"]));

  // Background jobs (client passed in) don't need avatar links.
  const avatarUrls = client ? new Map<string, string>() : await signAvatarPaths(
    (profiles ?? []).flatMap((p) => (opts.withFullAvatars ? [p.avatar_thumb_path, p.avatar_path] : [p.avatar_thumb_path])),
  );

  return rows
    .map((r): DirectoryPerson => {
      const p = profileById.get(r.user_id);
      return {
        membershipId: r.id,
        userId: r.user_id,
        name: p?.display_name ?? "Unknown",
        email: opts.showEmail === false ? null : (p?.email_display ?? null),
        jobTitle: r.job_title,
        employeeNumber: r.employee_number,
        status: r.status,
        departmentId: r.department_id,
        departmentName: r.department_id ? (deptById.get(r.department_id) ?? null) : null,
        managerMembershipId: r.manager_membership_id,
        managerName: r.manager_membership_id ? (nameByMembership.get(r.manager_membership_id) ?? null) : null,
        teams: (teamLinks ?? [])
          .filter((t) => t.membership_id === r.id)
          .map((t) => ({ id: t.team_id, name: teamById.get(t.team_id) ?? "Team", isLead: t.is_lead })),
        roles: (assignments ?? [])
          .filter((a) => a.membership_id === r.id)
          .map((a) => ({ id: a.role_id, name: roleById.get(a.role_id) ?? "Role", scopeType: a.scope_type, scopeId: a.scope_id })),
        timezone: p?.timezone ?? "UTC",
        startDate: r.start_date,
        avatarUrl: p?.avatar_thumb_path ? (avatarUrls.get(p.avatar_thumb_path) ?? null) : null,
        avatarFullUrl: p?.avatar_path ? (avatarUrls.get(p.avatar_path) ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterPeople(
  people: DirectoryPerson[],
  q: { text?: string; department?: string; team?: string },
): DirectoryPerson[] {
  const text = q.text?.trim().toLocaleLowerCase();
  return people.filter((p) => {
    if (q.department && p.departmentId !== q.department) return false;
    if (q.team && !p.teams.some((t) => t.id === q.team)) return false;
    if (text) {
      const hay = [p.name, p.jobTitle, p.email, p.departmentName, ...p.teams.map((t) => t.name)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
