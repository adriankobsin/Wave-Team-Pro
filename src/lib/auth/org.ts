import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveProfile, getAssuranceLevel } from "@/lib/auth/session";
import { PermissionSet, type EffectivePermission, type PermissionKey } from "@/lib/permissions/catalog";
import type { MembershipRow, OrganizationRow, OrgSettingsRow } from "@/lib/types";

export type OrgContext = {
  org: OrganizationRow;
  settings: OrgSettingsRow;
  membership: MembershipRow;
  perms: PermissionSet;
  userId: string;
  profile: Awaited<ReturnType<typeof requireActiveProfile>>["profile"];
  /** True when the org requires MFA for sensitive permissions and this session is not aal2. */
  mfaStepUpNeeded: boolean;
};

/**
 * Resolves the organization from the URL slug for the signed-in user. Responds 404 (not
 * 403) when the user is not an active member so organization existence is not disclosed.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const supabase = await createClient();
  // The session check and the organization lookup are independent: run them together.
  const [{ user, profile }, { data: org }] = await Promise.all([
    requireActiveProfile(),
    supabase
      .from("organizations")
      .select("id, name, slug, legal_entity_code, base_currency, timezone, country, status")
      .eq("slug", slug.toLowerCase())
      .maybeSingle(),
  ]);
  if (!org) notFound();

  const [{ data: membership }, { data: settings }, { data: perms }, aal] = await Promise.all([
    supabase
      .from("organization_memberships")
      .select("id, organization_id, user_id, employee_number, department_id, job_title, manager_membership_id, start_date, status, deactivated_at, created_at")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("organization_settings")
      .select("organization_id, mfa_required_for_sensitive, invitation_expiry_days, directory_show_email, site_toolkit_enabled")
      .eq("organization_id", org.id)
      .maybeSingle(),
    supabase.rpc("my_permissions", { p_org: org.id }),
    getAssuranceLevel(),
  ]);
  if (!membership || !settings || org.status !== "active") notFound();

  let mfaStepUpNeeded = false;
  if (settings.mfa_required_for_sensitive && aal.current !== "aal2") {
    // Only nag people whose roles actually include protected permissions.
    const { data: assigned } = await supabase
      .from("membership_role_assignments")
      .select("role_id")
      .eq("membership_id", membership.id);
    const roleIds = (assigned ?? []).map((a) => a.role_id as string);
    if (roleIds.length) {
      const [{ data: rp }, { data: sensitive }] = await Promise.all([
        supabase.from("role_permissions").select("permission_key").in("role_id", roleIds),
        supabase.from("permissions").select("key").eq("is_sensitive", true),
      ]);
      const keys = new Set((sensitive ?? []).map((k) => k.key as string));
      mfaStepUpNeeded = (rp ?? []).some((r) => keys.has(r.permission_key as string));
    }
  }

  return {
    org: org as OrganizationRow,
    settings: settings as OrgSettingsRow,
    membership: membership as MembershipRow,
    perms: new PermissionSet((perms as EffectivePermission[] | null) ?? []),
    userId: user.id,
    profile,
    mfaStepUpNeeded,
  };
});

/**
 * Authorization for Server Actions. Re-reads the session and asks the database (the same
 * evaluator RLS uses). Returns the user id when allowed.
 */
export async function authorize(orgId: string, permission: PermissionKey): Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return null;
  const { data, error } = await supabase.rpc("has_permission", { p_org: orgId, p_permission: permission });
  if (error || data !== true) return null;
  return { userId };
}
