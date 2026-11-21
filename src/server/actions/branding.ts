"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { formObject, uuid } from "@/lib/validation/common";
import type { ActionResult } from "@/lib/errors";
import { LogoError, processLogo } from "@/lib/images/logo";
import { BRAND } from "@/lib/brand";

export async function uploadLogo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const actor = await authorize(parsed.data.organization_id, "org.settings.manage");
  if (!actor) return { ok: false, error: "You don't have permission to change the logo." };
  const file = formData.get("logo");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose an image file." };
  let logo;
  try {
    logo = await processLogo(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: e instanceof LogoError ? e.message : "That image couldn't be used." };
  }
  const { error } = await createAdminClient().from("organization_branding").upsert({
    organization_id: parsed.data.organization_id, logo_png_base64: logo.png.toString("base64"),
    logo_width: logo.width, logo_height: logo.height, updated_by: actor.userId, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't save the logo. Try again." };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Logo saved. It now appears in the menu and on downloaded reports." };
}

export async function removeLogo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const actor = await authorize(parsed.data.organization_id, "org.settings.manage");
  if (!actor) return { ok: false, error: "You don't have permission to change the logo." };
  await createAdminClient().from("organization_branding").update({ logo_png_base64: null, logo_width: null, logo_height: null, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq("organization_id", parsed.data.organization_id);
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Logo removed." };
}

/** Group Hub's group logo: super admins (or platform admins) only. */
async function platformAdmin() {
  const { getHub } = await import("@/server/services/hub");
  const { getSessionUser } = await import("@/lib/auth/session");
  const hub = await getHub();
  const user = await getSessionUser();
  return hub && user && (hub.isPlatform || hub.companies.some((c) => c.can.settings)) ? user : null;
}

export async function uploadPlatformLogo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await platformAdmin();
  if (!user) return { ok: false, error: `Only super admins can change the ${BRAND.hub} logo.` };
  const file = formData.get("logo");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose an image file." };
  let logo;
  try {
    logo = await processLogo(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: e instanceof LogoError ? e.message : "That image couldn't be used." };
  }
  const { error } = await createAdminClient().from("platform_branding").update({
    logo_png_base64: logo.png.toString("base64"), logo_width: logo.width, logo_height: logo.height, updated_by: user.id, updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (error) return { ok: false, error: "Couldn't save the logo. Try again." };
  revalidatePath("/hub", "layout");
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: `Logo saved. It now shows at the top of ${BRAND.hub}.` };
}

export async function removePlatformLogo(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  void _formData;
  const user = await platformAdmin();
  if (!user) return { ok: false, error: `Only super admins can change the ${BRAND.hub} logo.` };
  await createAdminClient().from("platform_branding").update({ logo_png_base64: null, logo_width: null, logo_height: null, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", true);
  revalidatePath("/hub", "layout");
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Logo removed." };
}
