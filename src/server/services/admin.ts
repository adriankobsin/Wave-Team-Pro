import "server-only";
import { createClient } from "@/lib/supabase/server";

export type RoleWithPermissions = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_protected: boolean;
  permissions: string[];
  memberCount: number;
};

export type CatalogPermission = {
  key: string;
  module: string;
  description: string;
  allowed_scopes: string[];
  is_sensitive: boolean;
  sort_order: number;
};

export async function getPermissionCatalog(): Promise<CatalogPermission[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("permissions")
    .select("key, module, description, allowed_scopes, is_sensitive, sort_order")
    .order("sort_order");
  return (data as CatalogPermission[] | null) ?? [];
}

export async function listRoles(orgId: string): Promise<RoleWithPermissions[]> {
  const supabase = await createClient();
  const [{ data: roles }, { data: rp }, { data: assignments }] = await Promise.all([
    supabase.from("roles").select("id, key, name, description, is_system, is_protected").eq("organization_id", orgId),
    supabase.from("role_permissions").select("role_id, permission_key").eq("organization_id", orgId),
    supabase.from("membership_role_assignments").select("role_id, membership_id").eq("organization_id", orgId),
  ]);
  return (roles ?? [])
    .map((r) => ({
      ...(r as Omit<RoleWithPermissions, "permissions" | "memberCount">),
      permissions: (rp ?? []).filter((x) => x.role_id === r.id).map((x) => x.permission_key as string),
      memberCount: new Set((assignments ?? []).filter((a) => a.role_id === r.id).map((a) => a.membership_id)).size,
    }))
    .sort((a, b) => Number(b.is_protected) - Number(a.is_protected) || Number(b.is_system) - Number(a.is_system) || a.name.localeCompare(b.name));
}

export type AssignmentRow = { id: string; role_id: string; scope_type: string; scope_id: string | null; created_at: string };
export type OverrideRow = {
  id: string;
  permission_key: string;
  effect: "grant" | "deny";
  scope_type: string;
  scope_id: string | null;
  reason: string;
  expires_at: string | null;
  created_at: string;
};

export async function getMemberAccess(orgId: string, membershipId: string) {
  const supabase = await createClient();
  const [{ data: assignments }, { data: overrides }] = await Promise.all([
    supabase
      .from("membership_role_assignments")
      .select("id, role_id, scope_type, scope_id, created_at")
      .eq("organization_id", orgId)
      .eq("membership_id", membershipId)
      .order("created_at"),
    supabase
      .from("scoped_permission_overrides")
      .select("id, permission_key, effect, scope_type, scope_id, reason, expires_at, created_at")
      .eq("organization_id", orgId)
      .eq("membership_id", membershipId)
      .order("created_at"),
  ]);
  return { assignments: (assignments as AssignmentRow[] | null) ?? [], overrides: (overrides as OverrideRow[] | null) ?? [] };
}

export type InvitationRow = {
  id: string;
  email: string;
  display_name: string | null;
  role_id: string;
  job_title: string | null;
  status: "pending" | "accepted" | "revoked";
  invited_by: string | null;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};

export async function listInvitations(orgId: string): Promise<InvitationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invitations")
    .select("id, email, display_name, role_id, job_title, status, invited_by, expires_at, created_at, accepted_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data as InvitationRow[] | null) ?? [];
}

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_role: string;
  action: "insert" | "update" | "delete";
  target_table: string;
  target_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
};

export async function listAudit(orgId: string, opts: { before?: string; table?: string; limit?: number } = {}) {
  const supabase = await createClient();
  let q = supabase
    .from("audit_logs")
    .select("id, actor_user_id, actor_role, action, target_table, target_id, old_values, new_values, changed_fields, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("created_at", opts.before);
  if (opts.table) q = q.eq("target_table", opts.table);
  const { data } = await q;
  return (data as AuditRow[] | null) ?? [];
}
