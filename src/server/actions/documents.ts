"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { emailManagement } from "@/server/services/management-email";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UploadError, validateUpload } from "@/lib/files/validate";
import { storeFile } from "@/server/services/files";
import { consumeRateLimit } from "@/lib/rate-limit";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}

const folderSchema = z.object({
  organization_id: uuid,
  name: z.string().trim().min(1, "Enter a name").max(100),
  scope: z.enum(["organization", "department", "team", "personal", "hr"]),
  scope_id: z.union([z.literal(""), uuid]).optional().transform((v) => v || null),
  parent_id: z.union([z.literal(""), uuid]).optional().transform((v) => v || null),
});

export async function createFolder(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = folderSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const d = parsed.data;
  if ((d.scope === "team" || d.scope === "department") && !d.scope_id) return { ok: false, error: "Choose which team or department." };
  const { error } = await supabase.from("folders").insert({
    organization_id: d.organization_id,
    name: d.name,
    scope: d.scope,
    scope_id: d.scope === "team" || d.scope === "department" ? d.scope_id : null,
    owner_id: d.scope === "personal" ? userId : null,
    parent_id: d.parent_id,
    created_by: userId,
  });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't create a folder there.") };
  revalidatePath("/o/[org]/documents", "layout");
  return { ok: true, message: "Folder created." };
}

const uploadSchema = z.object({
  organization_id: uuid,
  folder_id: uuid,
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  tags: z.string().max(300).optional(),
  document_id: z.union([z.literal(""), uuid]).optional().transform((v) => v || null),
  note: z.string().trim().max(300).optional(),
});

/** Uploads a new document, or a new version of an existing one when document_id is set. */
export async function uploadDocument(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = uploadSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the form." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (!(await consumeRateLimit(["doc-upload", userId], 60, 3600))) return { ok: false, error: "Upload limit reached. Try again later." };

  const d = parsed.data;
  const { data: canWrite } = await supabase.rpc("can_write_folder", { p_folder: d.folder_id });
  if (canWrite !== true) return { ok: false, error: "You can't upload to this folder." };

  let upload;
  try {
    upload = await validateUpload(file);
  } catch (e) {
    return { ok: false, error: e instanceof UploadError ? e.message : "This file couldn't be processed." };
  }

  const admin = createAdminClient();
  try {
    let docId = d.document_id;
    let version = 1;
    if (docId) {
      const { data: doc } = await supabase.from("documents").select("id, folder_id, current_version").eq("id", docId).maybeSingle();
      if (!doc || doc.folder_id !== d.folder_id) return { ok: false, error: "Document not found." };
      version = doc.current_version + 1;
    } else {
      const tags = (d.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10);
      const { data: doc, error } = await admin
        .from("documents")
        .insert({
          organization_id: d.organization_id,
          folder_id: d.folder_id,
          title: d.title || upload.fileName.replace(/\.[^.]+$/, ""),
          description: d.description || null,
          tags,
          uploaded_by: userId,
        })
        .select("id")
        .single();
      if (error || !doc) throw error;
      docId = doc.id as string;
    }
    const stored = await storeFile({ orgId: d.organization_id, userId, context: "document", contextId: docId!, upload });
    await admin.from("document_versions").insert({ document_id: docId, version, file_id: stored.id, note: d.note || null, uploaded_by: userId });
    await admin.from("documents").update({ current_file_id: stored.id, current_version: version, updated_by: userId }).eq("id", docId);
  } catch (e) {
    logServerError("documents.upload", e);
    return { ok: false, error: "Upload failed. Try again." };
  }
  revalidatePath("/o/[org]/documents", "layout");
  after(async () => {
    const { data: org } = await supabase.from("organizations").select("slug").eq("id", d.organization_id).single();
    const { data: me } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
    await emailManagement(d.organization_id, "upload", `${me?.display_name ?? "Someone"} uploaded ${upload.fileName}`, "Added to Documents.", `/o/${org?.slug ?? ""}/documents/${d.folder_id}`, userId);
  });
  return { ok: true, message: d.document_id ? "New version uploaded." : "Document uploaded." };
}

export async function archiveDocument(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ document_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown document." };
  const { supabase } = await session();
  const { data, error } = await supabase.from("documents").update({ archived_at: new Date().toISOString() }).eq("id", parsed.data.document_id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't remove this document.") };
  revalidatePath("/o/[org]/documents", "layout");
  return { ok: true, message: "Document removed." };
}
