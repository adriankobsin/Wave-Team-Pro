"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import { fieldErrors } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";

const publishSchema = z.object({
  organization_id: uuid,
  title: z.string().trim().min(2, "Add a title").max(160),
  body: z.string().trim().min(1, "Write the announcement").max(10000),
  audience: z.enum(["organization", "team"]),
  team_id: z.union([z.literal(""), uuid]).optional().transform((v) => v || null),
  requires_ack: z.literal("on").optional().transform((v) => v === "on"),
  pinned: z.literal("on").optional().transform((v) => v === "on"),
  expires_at: z.union([z.literal(""), z.iso.date()]).optional().transform((v) => (v ? new Date(`${v}T23:59:59Z`).toISOString() : null)),
});

export async function publishAnnouncement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = publishSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (parsed.data.audience === "team" && !parsed.data.team_id) return { ok: false, error: "Choose a team.", fieldErrors: { team_id: ["Choose a team"] } };
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({ ...parsed.data, team_id: parsed.data.audience === "team" ? parsed.data.team_id : null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/o/[org]/announcements", "page");
  return { ok: true, message: "Announcement published." };
}

export async function acknowledgeAnnouncement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ announcement_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown announcement." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Sign in again." };
  const { error } = await supabase.from("announcement_acknowledgements").upsert(
    { announcement_id: parsed.data.announcement_id, user_id: data.user.id },
    { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/o/[org]/announcements", "page");
  return { ok: true, message: "Acknowledged." };
}

export async function archiveAnnouncement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ announcement_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown announcement." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("announcements").update({ archived_at: new Date().toISOString() }).eq("id", parsed.data.announcement_id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't archive this announcement.") };
  revalidatePath("/o/[org]/announcements", "page");
  return { ok: true, message: "Archived." };
}
