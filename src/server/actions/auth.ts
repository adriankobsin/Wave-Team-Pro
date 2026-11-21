"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { email as emailSchema, fieldErrors, password as passwordSchema } from "@/lib/validation/common";
import { safeNextPath } from "@/lib/utils";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { findInvitationByToken } from "@/server/services/invitations";
import { emailManagement } from "@/server/services/management-email";
import { after } from "next/server";
import type { ActionResult } from "@/lib/errors";
import { BRAND } from "@/lib/brand";
import { isDemoAccount } from "@/lib/demo";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

const signInSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128) });

export async function signIn(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const ip = await clientIp();
  // Shared demo accounts are used by many visitors at once: only the per-IP limit applies to them.
  const allowedByAccount = isDemoAccount(parsed.data.email) || await consumeRateLimit(["signin", parsed.data.email], 8, 15 * 60);
  const allowedByIp = await consumeRateLimit(["signin-ip", ip], 40, 15 * 60);
  if (!allowedByAccount || !allowedByIp) {
    return { ok: false, error: "Too many sign-in attempts. Wait 15 minutes and try again, or reset your password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // One message for wrong email, wrong password and banned accounts: no account enumeration.
    return { ok: false, error: "That email and password don't match an active account." };
  }

  const next = safeNextPath(String(formData.get("next") ?? ""), "/");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function requestPasswordReset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (BRAND.demo) return { ok: false, error: "This is a demo: account security settings are locked so every visitor can sign in." };
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, error: "Enter a valid email address.", fieldErrors: { email: ["Enter a valid email address"] } };
  const ip = await clientIp();
  const allowed =
    (await consumeRateLimit(["reset", parsed.data], 3, 60 * 60)) && (await consumeRateLimit(["reset-ip", ip], 20, 60 * 60));
  if (allowed) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${publicEnv().APP_BASE_URL}/auth/callback?next=/auth/set-password`,
    });
  }
  // Same response whether or not the account exists or the limit was hit.
  return { ok: true, message: "If that email belongs to an account, a reset link is on its way. It expires in one hour." };
}

const setPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export async function setPassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (BRAND.demo) return { ok: false, error: "This is a demo: account security settings are locked so every visitor can sign in." };
  const parsed = setPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ok: false, error: "Your link has expired. Request a new one from the sign-in page." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      ok: false,
      error: /same/i.test(error.message)
        ? "Choose a password you haven't used here before."
        : /reauth|recent/i.test(error.message)
          ? "For security, sign in again before changing your password."
          : "Couldn't set the password. Try a longer one.",
    };
  }
  redirect(safeNextPath(String(formData.get("next") ?? ""), "/"));
}

export async function signOutOtherSessions(): Promise<ActionResult> {
  if (BRAND.demo) return { ok: false, error: "This is a demo: account security settings are locked so every visitor can sign in." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false, error: "Couldn't sign out other devices. Try again." };
  return { ok: true, message: "Signed out on every other device." };
}

/**
 * Completes an invitation from the app's own link: signs the invited person in (creating the
 * account if needed), accepts the invitation, and sends them to choose a password.
 */
export async function acceptInvitationLink(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get("token") ?? "");
  const ip = await clientIp();
  if (!(await consumeRateLimit(["accept-link", ip], 30, 15 * 60))) return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  const inv = await findInvitationByToken(token);
  if (!inv) return { ok: false, error: "This invitation link is no longer valid. Ask your administrator to send a new one." };

  const admin = createAdminClient();
  let existing = false;
  let link = await admin.auth.admin.generateLink({ type: "invite", email: inv.email, options: { data: inv.display_name ? { display_name: inv.display_name } : undefined } });
  if (link.error) {
    existing = true;
    link = await admin.auth.admin.generateLink({ type: "magiclink", email: inv.email });
  }
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) return { ok: false, error: "We couldn't prepare your account. Try again in a minute." };

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: existing ? "magiclink" : "invite", token_hash: hashed });
  if (verifyError) return { ok: false, error: "We couldn't sign you in. Try again in a minute." };

  const { error: acceptError } = await supabase.rpc("accept_invitation", { p_invitation: inv.id });
  if (acceptError && acceptError.code !== "23505") return { ok: false, error: "Your account is ready, but joining the company failed. Ask your administrator to check the invitation." };
  await admin.from("invitation_links").update({ used_at: new Date().toISOString() }).eq("invitation_id", inv.id);
  // The same person may have been invited to several companies at once: join them all.
  const { data: more } = await supabase.rpc("list_my_pending_invitations");
  for (const p of (more ?? []) as { invitation_id: string }[]) {
    await supabase.rpc("accept_invitation", { p_invitation: p.invitation_id });
  }
  after(() => emailManagement(inv.organization_id, "member_joined", `${inv.display_name ?? inv.email} has joined ${inv.org_name}`, "Their registration is complete.", `/o/${inv.org_slug}/people`, null));

  const next = inv.org_slug ? `/o/${inv.org_slug}?welcome=1` : "/";
  redirect(`/auth/set-password?next=${encodeURIComponent(next)}${existing ? "&existing=1" : ""}`);
}
