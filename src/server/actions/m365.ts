"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { formObject, uuid } from "@/lib/validation/common";
import { logServerError, type ActionResult } from "@/lib/errors";
import { graphConfigured } from "@/lib/sharepoint/graph";
import { runM365Sync } from "@/server/services/m365-sync";

const refresh = () => revalidatePath("/o/[org]/admin/m365", "page");

export async function saveM365Settings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
  const orgId = parsed.data.organization_id;
  if (!(await authorize(orgId, "org.settings.manage"))) return { ok: false, error: "You don't have permission to change these settings." };
  const enabled = formData.get("enabled") === "on";
  const { error } = await createAdminClient().from("m365_sync_settings").upsert({ organization_id: orgId, enabled }, { onConflict: "organization_id" });
  if (error) { logServerError("saveM365Settings", error); return { ok: false, error: "Couldn't save. Try again." }; }
  refresh();
  return { ok: true, message: enabled ? "Saved. Projects sync within 15 minutes, or press Sync now." : "Saved. Sync is off; nothing in Microsoft 365 is deleted." };
}

export async function syncM365Now(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
  const orgId = parsed.data.organization_id;
  if (!(await authorize(orgId, "org.settings.manage"))) return { ok: false, error: "You don't have permission to do this." };
  if (!graphConfigured()) return { ok: false, error: "Microsoft 365 isn't connected yet (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET)." };
  const admin = createAdminClient();
  const { data: s } = await admin.from("m365_sync_settings").select("enabled").eq("organization_id", orgId).maybeSingle();
  if (!s?.enabled) return { ok: false, error: "Switch Microsoft 365 project sync on first." };
  const r = await runM365Sync({ orgId, budgetMs: 50_000 });
  refresh();
  if (!r.ok) return { ok: false, error: r.errors[0]?.error ?? "The sync didn't finish. See the report below." };
  return { ok: true, message: `Synced ${r.projects} project${r.projects === 1 ? "" : "s"}${r.remaining ? `; ${r.remaining} more on the next run` : ""}.` };
}
