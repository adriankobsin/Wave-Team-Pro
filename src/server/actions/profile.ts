"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AvatarError, parseCrop, parseRotation, processAvatar } from "@/lib/images/avatar";
import { consumeRateLimit } from "@/lib/rate-limit";
import { fieldErrors, formObject } from "@/lib/validation/common";
import { profileUpdateSchema } from "@/lib/validation/schemas";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";

export async function updateProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = profileUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Sign in again to continue." };

  const { phone, ...profile } = parsed.data;
  const { error } = await supabase.from("profiles").update(profile).eq("id", auth.user.id);
  if (error) {
    logServerError("profile.update", error);
    return { ok: false, error: friendlyDbError(error) };
  }
  const { error: privErr } = await supabase.from("profile_private").update({ phone }).eq("user_id", auth.user.id);
  if (privErr) {
    logServerError("profile.private", privErr);
    return { ok: false, error: friendlyDbError(privErr) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

/**
 * Accepts a camera capture or file, re-encodes it server-side (EXIF/GPS stripped), stores
 * it in the private avatars bucket under the caller's own folder, and points the profile at
 * it. The old files are removed afterwards.
 */
export async function uploadAvatar(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { ok: false, error: "Sign in again to continue." };

  if (!(await consumeRateLimit(["avatar", user.id], 20, 60 * 60))) {
    return { ok: false, error: "You've changed your photo many times this hour. Try again later." };
  }

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo first." };

  let processed;
  try {
    processed = await processAvatar({
      bytes: new Uint8Array(await file.arrayBuffer()),
      crop: parseCrop(String(formData.get("crop") ?? "")),
      rotate: parseRotation(String(formData.get("rotate") ?? "0")),
    });
  } catch (e) {
    if (e instanceof AvatarError) return { ok: false, error: e.message };
    logServerError("avatar.process", e);
    return { ok: false, error: "This image couldn't be processed. Try a different photo." };
  }

  const { data: current } = await supabase
    .from("profiles")
    .select("avatar_path, avatar_thumb_path")
    .eq("id", user.id)
    .single();

  const stamp = randomUUID();
  const fullPath = `${user.id}/${stamp}.webp`;
  const thumbPath = `${user.id}/${stamp}-thumb.webp`;
  const admin = createAdminClient();
  const bucket = admin.storage.from("avatars");
  const up1 = await bucket.upload(fullPath, processed.full, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
  const up2 = up1.error
    ? up1
    : await bucket.upload(thumbPath, processed.thumb, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
  if (up1.error || up2.error) {
    logServerError("avatar.upload", up1.error ?? up2.error);
    await bucket.remove([fullPath, thumbPath]);
    return { ok: false, error: "Upload failed. Check your connection and try again." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: fullPath, avatar_thumb_path: thumbPath })
    .eq("id", user.id);
  if (error) {
    logServerError("avatar.profile", error);
    await bucket.remove([fullPath, thumbPath]);
    return { ok: false, error: friendlyDbError(error) };
  }

  const old = [current?.avatar_path, current?.avatar_thumb_path].filter((p): p is string => Boolean(p));
  if (old.length) await bucket.remove(old);
  revalidatePath("/", "layout");
  return { ok: true, message: "Photo updated." };
}

export async function removeAvatar(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Sign in again to continue." };
  const { data: current } = await supabase
    .from("profiles")
    .select("avatar_path, avatar_thumb_path")
    .eq("id", auth.user.id)
    .single();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null, avatar_thumb_path: null })
    .eq("id", auth.user.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  const old = [current?.avatar_path, current?.avatar_thumb_path].filter((p): p is string => Boolean(p));
  if (old.length) await createAdminClient().storage.from("avatars").remove(old);
  revalidatePath("/", "layout");
  return { ok: true, message: "Photo removed. Your initials are shown instead." };
}
