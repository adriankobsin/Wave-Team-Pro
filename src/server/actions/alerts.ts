"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";

const ALERT_EVENTS = ["member_joined", "upload", "timesheet_submitted", "clock", "weekly_timesheets"] as const;

export async function saveManagementAlert(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid,
    event: z.enum(ALERT_EVENTS),
    enabled: z.literal("on").optional().transform((v) => v === "on"),
    email: z.literal("on").optional().transform((v) => v === "on"),
    mode: z.enum(["default", "custom"]),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the form." };
  const d = parsed.data;
  const recipients = formData.getAll("recipients").map(String).filter((v) => uuid.safeParse(v).success);
  if (d.mode === "custom" && d.enabled && !recipients.length) return { ok: false, error: "Choose at least one person, or use the default recipients." };
  const supabase = await createClient();
  const values = { enabled: d.enabled, email: d.email, custom_recipients: d.mode === "custom" };
  const { data: existing } = await supabase.from("management_alert_events").select("event").eq("organization_id", d.organization_id).eq("event", d.event).maybeSingle();
  const { error } = existing
    ? await supabase.from("management_alert_events").update(values).eq("organization_id", d.organization_id).eq("event", d.event)
    : await supabase.from("management_alert_events").insert({ organization_id: d.organization_id, event: d.event, ...values });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change notification settings.") };
  const { error: delErr } = await supabase.from("management_alert_recipients").delete().eq("organization_id", d.organization_id).eq("event", d.event);
  if (delErr) return { ok: false, error: friendlyDbError(delErr) };
  if (d.mode === "custom" && recipients.length) {
    const { error: insErr } = await supabase.from("management_alert_recipients").insert(recipients.map((m) => ({ organization_id: d.organization_id, event: d.event, membership_id: m })));
    if (insErr) return { ok: false, error: friendlyDbError(insErr) };
  }
  revalidatePath("/o/[org]/admin/settings", "page");
  return { ok: true, message: "Saved." };
}
