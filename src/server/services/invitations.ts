import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { emailButton, emailConfigured, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { BRAND } from "@/lib/brand";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Creates a new personal set-up link for a pending invitation. */
export async function createInvitationLink(invitationId: string, createdBy: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const admin = createAdminClient();
  const { error } = await admin.from("invitation_links").insert({ token_hash: hashToken(token), invitation_id: invitationId, created_by: createdBy });
  if (error) throw error;
  return `${publicEnv().APP_BASE_URL}/auth/accept?i=${token}`;
}

export type LinkedInvitation = {
  id: string;
  email: string;
  display_name: string | null;
  organization_id: string;
  org_name: string;
  org_slug: string;
  expires_at: string;
};

/** Looks up a still-valid invitation by link token (pending and not expired). */
export async function findInvitationByToken(token: string): Promise<LinkedInvitation | null> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data: link } = await admin.from("invitation_links").select("invitation_id").eq("token_hash", hashToken(token)).maybeSingle();
  if (!link) return null;
  const { data: inv } = await admin.from("invitations").select("id, email, display_name, organization_id, status, expires_at").eq("id", link.invitation_id).maybeSingle();
  if (!inv || inv.status !== "pending" || new Date(inv.expires_at) <= new Date()) return null;
  const { data: org } = await admin.from("organizations").select("name, slug").eq("id", inv.organization_id).single();
  return { id: inv.id, email: String(inv.email), display_name: inv.display_name, organization_id: inv.organization_id, org_name: org?.name ?? BRAND.group, org_slug: org?.slug ?? "", expires_at: inv.expires_at };
}

/**
 * Delivers an invitation. With an email provider configured, the app sends its own email
 * containing the personal link. Otherwise it falls back to Supabase's built-in invite email
 * (limited to a few per hour). The link is always returned so an admin can share it directly.
 */
export async function deliverInvitation(opts: { invitationId: string; email: string; displayName: string | null; orgName: string; inviterName: string; createdBy: string; alsoCompanies?: string[] }) {
  const link = await createInvitationLink(opts.invitationId, opts.createdBy);
  const expiry = "The link is valid until the invitation expires.";
  if (emailConfigured()) {
    const html = emailLayout(
      `You're invited to ${escapeHtml(opts.orgName)}`,
      `<p>Hi${opts.displayName ? ` ${escapeHtml(opts.displayName)}` : ""},</p>
<p>${escapeHtml(opts.inviterName)} has invited you to ${escapeHtml(BRAND.product)}, where you'll find chat, schedules, timesheets, leave and expenses.</p>
${opts.alsoCompanies?.length ? `<p>You'll also join ${escapeHtml(opts.alsoCompanies.join(", "))}; switch between companies from the menu.</p>` : ""}
<p>Press the button to choose your password. ${expiry}</p>${emailButton(link, "Set up my account")}`,
    );
    const sent = await sendEmail({ to: [opts.email], subject: `Your invitation to ${opts.orgName} on ${BRAND.product}`, html, text: `Set up your account: ${link}` });
    return { link, emailed: sent, via: sent ? ("app" as const) : ("none" as const) };
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(opts.email, {
    redirectTo: `${publicEnv().APP_BASE_URL}/auth/callback?next=/auth/set-password`,
    data: opts.displayName ? { display_name: opts.displayName } : undefined,
  });
  return { link, emailed: !error, via: error ? ("none" as const) : ("supabase" as const), existing: error?.code === "email_exists" };
}
