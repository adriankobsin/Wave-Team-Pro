import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Logo = { png: Buffer; width: number; height: number };

/** The company logo as a PNG (for PDFs and Excel), or null when none was uploaded. */
export async function getLogo(orgId: string, client?: SupabaseClient): Promise<Logo | null> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase.from("organization_branding").select("logo_png_base64, logo_width, logo_height").eq("organization_id", orgId).maybeSingle();
  if (!data?.logo_png_base64) return null;
  return { png: Buffer.from(data.logo_png_base64 as string, "base64"), width: data.logo_width ?? 300, height: data.logo_height ?? 100 };
}

/** Version stamp for the logo URL (changes when a new logo is uploaded), or null. */
export async function logoVersion(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("organization_branding").select("updated_at, logo_width").eq("organization_id", orgId).maybeSingle();
  return data?.logo_width ? String(Date.parse(data.updated_at as string)) : null;
}

/** Group Hub's own logo (the group), or null. */
export async function getPlatformLogo(client?: SupabaseClient): Promise<Logo | null> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase.from("platform_branding").select("logo_png_base64, logo_width, logo_height").eq("id", true).maybeSingle();
  if (!data?.logo_png_base64) return null;
  return { png: Buffer.from(data.logo_png_base64 as string, "base64"), width: data.logo_width ?? 300, height: data.logo_height ?? 100 };
}

export async function platformLogoVersion(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_branding").select("updated_at, logo_width").eq("id", true).maybeSingle();
  return data?.logo_width ? String(Date.parse(data.updated_at as string)) : null;
}

/**
 * The logo of the company a project belongs to (its own company, whichever company page it was
 * opened from). Call only after checking the viewer may see the project; the logo isn't sensitive.
 */
export async function getProjectLogo(projectId: string): Promise<Logo | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  return data?.organization_id ? getLogo(data.organization_id as string, admin) : null;
}
