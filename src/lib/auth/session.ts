import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MyOrganization, ProfileRow } from "@/lib/types";

/**
 * Current user from the session token, memoized per request. The token's signature is checked
 * locally against the project's published signing keys (no round trip to Supabase Auth on every
 * page); deactivated people are still stopped by the profile status check and by row-level security.
 */
export const getSessionUser = cache(async (): Promise<{ id: string; email: string | null } | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string") return null;
  return { id: sub, email: typeof data?.claims?.email === "string" ? (data.claims.email as string) : null };
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export const getMyProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_path, avatar_thumb_path, email_display, locale, timezone, status")
    .eq("id", user.id)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
});

/** Signed-in, active profile, or redirect. Deactivated accounts are signed out. */
export async function requireActiveProfile() {
  const user = await requireUser();
  const profile = await getMyProfile();
  if (!profile || profile.status !== "active") redirect("/auth/signout?reason=deactivated");
  return { user, profile };
}

export const getMyOrganizations = cache(async (): Promise<MyOrganization[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_organizations");
  return (data as MyOrganization[] | null) ?? [];
});

export const getAssuranceLevel = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { current: data?.currentLevel ?? "aal1", next: data?.nextLevel ?? "aal1" };
});
