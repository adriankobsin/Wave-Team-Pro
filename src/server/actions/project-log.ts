"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formObject, uuid } from "@/lib/validation/common";
import { isDateString, zonedToUtc } from "@/lib/time";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { UploadError, validateUpload } from "@/lib/files/validate";

const optText = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);

const noteSchema = z.object({
  project_id: uuid,
  kind: z.enum(["note", "delivery", "order", "issue", "meeting", "other"]),
  title: z.string().trim().min(2, "Write a short title").max(200),
  body: optText(8000),
  supplier: optText(200),
  reference: optText(120),
  amount: z.union([z.literal(""), z.coerce.number().min(0).max(1e12)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  currency: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Three-letter currency code")]).optional().transform((v) => v || null),
  date: z.string().refine(isDateString, "Choose a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time"),
  tz: z.string().min(1).max(64),
});

/** Adds an entry to a project's log, with optional photos or PDFs (delivery notes, order confirmations). */
export async function addProjectNote(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { tz, date, time, ...n } = parsed.data;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ok: false, error: "Sign in again." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 10) return { ok: false, error: "Up to 10 files at a time." };
  const uploads = [];
  for (const f of files) {
    try {
      uploads.push(await validateUpload(f, "image-or-pdf"));
    } catch (e) {
      return { ok: false, error: e instanceof UploadError ? `${f.name}: ${e.message}` : `${f.name} couldn't be processed.` };
    }
  }

  let occurredAt: string;
  try {
    occurredAt = zonedToUtc(date, time, tz);
  } catch {
    occurredAt = new Date().toISOString();
  }
  const { data: note, error } = await supabase.from("project_notes")
    .insert({ ...n, currency: n.amount !== null ? n.currency : null, occurred_at: occurredAt })
    .select("id, organization_id").single();
  if (error || !note) return { ok: false, error: friendlyDbError(error, "You can't add notes to this project.") };

  if (uploads.length) {
    const admin = createAdminClient();
    try {
      for (const u of uploads) {
        const path = `${note.organization_id}/project-log/${note.id}/${randomUUID()}.${u.ext}`;
        const { error: upErr } = await admin.storage.from("files").upload(path, u.bytes, { contentType: u.mime, upsert: false, cacheControl: "private, max-age=0" });
        if (upErr) throw upErr;
        const { error: rowErr } = await admin.from("project_note_files").insert({
          note_id: note.id, storage_path: path, file_name: u.fileName, mime_type: u.mime, size_bytes: u.size, uploaded_by: user.user.id,
        });
        if (rowErr) {
          await admin.storage.from("files").remove([path]);
          throw rowErr;
        }
      }
    } catch (e) {
      logServerError("project-log.files", e);
      revalidatePath("/o/[org]", "layout");
      return { ok: true, message: "Saved, but the files couldn't be uploaded. Try adding them again." };
    }
  }
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Added to the project log." };
}

/** Takes an entry off the log (kept in the audit trail). Author or project manager. */
export async function removeProjectNote(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_notes").update({ archived_at: new Date().toISOString() }).eq("id", parsed.data.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "Only the author or the project manager can remove this.") };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Removed." };
}
