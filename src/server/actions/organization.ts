"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formObject } from "@/lib/validation/common";
import { createOrgSchema, orgSettingsSchema } from "@/lib/validation/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { BRAND } from "@/lib/brand";

export async function updateOrganizationSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = orgSettingsSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { organization_id, directory_show_email, invitation_expiry_days, site_toolkit_enabled, ...org } = parsed.data;
  // Demo sites can't require MFA: visitors share the demo accounts.
  const mfa_required_for_sensitive = BRAND.demo ? false : parsed.data.mfa_required_for_sensitive;
  if (!(await authorize(organization_id, "org.settings.manage"))) return { ok: false, error: "You don't have permission to change organization settings." };
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update(org).eq("id", organization_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  const { error: sErr } = await supabase
    .from("organization_settings")
    .update({ mfa_required_for_sensitive, directory_show_email, invitation_expiry_days, site_toolkit_enabled })
    .eq("organization_id", organization_id);
  if (sErr) return { ok: false, error: friendlyDbError(sErr) };
  revalidatePath("/o/[org]", "layout");
  return {
    ok: true,
    message: mfa_required_for_sensitive
      ? "Settings saved. Admin and finance permissions now need two-step verification."
      : "Settings saved.",
  };
}

/** Platform owner: create an organization shell and invite its first Super Admin. */
export async function createOrganization(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createOrgSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: input.name,
    p_slug: input.slug,
    p_base_currency: input.base_currency,
    p_timezone: input.timezone,
    p_country: input.country,
    p_legal_entity_code: input.legal_entity_code,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That web address is taken.", fieldErrors: { slug: ["Choose another address"] } };
    return { ok: false, error: friendlyDbError(error) };
  }
  const { error: invErr } = await supabase.rpc("create_initial_invitation", {
    p_org: orgId,
    p_email: input.admin_email,
    p_display_name: input.admin_name,
  });
  if (invErr) return { ok: false, error: friendlyDbError(invErr) };

  const { error: mailErr } = await createAdminClient().auth.admin.inviteUserByEmail(input.admin_email, {
    redirectTo: `${publicEnv().APP_BASE_URL}/auth/callback?next=/auth/set-password`,
    data: input.admin_name ? { display_name: input.admin_name } : undefined,
  });
  revalidatePath("/platform");
  if (mailErr && !/already been registered|exists/i.test(mailErr.message)) {
    logServerError("platform.invite", mailErr);
    return { ok: true, message: `${input.name} created. The invitation email failed to send; ask ${input.admin_email} to use "Forgot password".` };
  }
  return { ok: true, message: `${input.name} created. ${input.admin_email} has been invited as Super Admin.` };
}
