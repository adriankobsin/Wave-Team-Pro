"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";
import type { ActionResult } from "@/lib/errors";
import { BRAND } from "@/lib/brand";

const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

export type EnrollResult = ActionResult<{ factorId: string; qr: string; secret: string }>;

export async function startTotpEnrollment(): Promise<EnrollResult> {
  const supabase = await createClient();
  // Remove abandoned, unverified factors so the user can retry cleanly.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { ok: false, error: "Two-step verification isn't available right now." };
  return { ok: true, data: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function verifyTotpEnrollment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (BRAND.demo) return { ok: false, error: "This is a demo: account security settings are locked so every visitor can sign in." };
  const factorId = z.uuid().safeParse(formData.get("factor_id"));
  const parsed = code.safeParse(formData.get("code"));
  if (!factorId.success || !parsed.success) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: parsed.data });
  if (error) return { ok: false, error: "That code didn't match. Codes change every 30 seconds — try the current one." };
  return { ok: true, message: "Two-step verification is on." };
}

export async function verifyMfaStepUp(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = code.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid code" };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = factors?.totp?.[0];
  if (!totp) return { ok: false, error: "Set up an authenticator app first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: parsed.data });
  if (error) return { ok: false, error: "That code didn't match. Try the current one." };
  redirect(safeNextPath(String(formData.get("next") ?? ""), "/"));
}

export async function removeTotpFactor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (BRAND.demo) return { ok: false, error: "This is a demo: account security settings are locked so every visitor can sign in." };
  const factorId = z.uuid().safeParse(formData.get("factor_id"));
  if (!factorId.success) return { ok: false, error: "Unknown factor." };
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return { ok: false, error: "Verify with your authenticator code before turning two-step verification off." };
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factorId.data });
  if (error) return { ok: false, error: "Couldn't remove the authenticator. Try again." };
  return { ok: true, message: "Authenticator removed." };
}
