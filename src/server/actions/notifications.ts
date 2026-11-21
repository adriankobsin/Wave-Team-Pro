"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import type { ActionResult } from "@/lib/errors";

export async function markNotificationsRead(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, notification_id: z.union([z.literal(""), uuid]).optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("organization_id", parsed.data.organization_id).is("read_at", null);
  if (parsed.data.notification_id) q = q.eq("id", parsed.data.notification_id);
  await q;
  revalidatePath("/o/[org]", "layout");
  return { ok: true };
}

/** Group Hub: mark every unread notification read, in every company. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function markAllNotificationsRead(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub;
  if (typeof me !== "string") return { ok: false, error: "Please sign in again." };
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me).is("read_at", null);
  revalidatePath("/hub", "layout");
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "All caught up." };
}
