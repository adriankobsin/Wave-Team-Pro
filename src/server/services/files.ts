import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ValidatedUpload } from "@/lib/files/validate";

export type FileContext = "message" | "document" | "expense" | "task" | "announcement";

export type StoredFile = { id: string; file_name: string; mime_type: string; size_bytes: number };

/**
 * Stores a validated upload. Callers MUST already have authorized the user for the
 * context object; this function writes with the service role. The storage path is built
 * from server-side ids only.
 */
export async function storeFile(opts: {
  orgId: string;
  userId: string;
  context: FileContext;
  contextId: string;
  upload: ValidatedUpload;
}): Promise<StoredFile> {
  const admin = createAdminClient();
  const path = `${opts.orgId}/${opts.context}/${opts.contextId}/${randomUUID()}.${opts.upload.ext}`;
  const { error: upErr } = await admin.storage
    .from("files")
    .upload(path, opts.upload.bytes, { contentType: opts.upload.mime, upsert: false, cacheControl: "private, max-age=0" });
  if (upErr) throw upErr;
  const { data, error } = await admin
    .from("files")
    .insert({
      organization_id: opts.orgId,
      storage_path: path,
      file_name: opts.upload.fileName,
      mime_type: opts.upload.mime,
      size_bytes: opts.upload.size,
      sha256: opts.upload.sha256,
      context_type: opts.context,
      context_id: opts.contextId,
      uploaded_by: opts.userId,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (error || !data) {
    await admin.storage.from("files").remove([path]);
    throw error ?? new Error("file insert failed");
  }
  return data as StoredFile;
}

/** Signed URL issued with the viewer's own session, so storage RLS decides. */
export async function signedFileUrl(fileId: string, opts: { download?: boolean; seconds?: number } = {}) {
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("files")
    .select("storage_path, file_name, mime_type")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return null;
  const { data } = await supabase.storage
    .from("files")
    .createSignedUrl(file.storage_path, opts.seconds ?? 120, opts.download ? { download: file.file_name } : undefined);
  return data?.signedUrl ? { url: data.signedUrl, file } : null;
}


export { formatBytes } from "@/lib/format";
