import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Folder = { id: string; name: string; scope: string; scope_id: string | null; parent_id: string | null; owner_id: string | null };

export async function listFolders(orgId: string): Promise<Folder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("folders")
    .select("id, name, scope, scope_id, parent_id, owner_id")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name");
  return (data as Folder[] | null) ?? [];
}

export async function listDocuments(orgId: string, opts: { folderId?: string; search?: string } = {}) {
  const supabase = await createClient();
  let q = supabase
    .from("documents")
    .select("id, folder_id, title, description, tags, current_file_id, current_version, uploaded_by, updated_by, updated_at, files:current_file_id(file_name, mime_type, size_bytes)")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (opts.folderId) q = q.eq("folder_id", opts.folderId);
  if (opts.search) q = q.or(`title.ilike.%${opts.search.replace(/[%_,()]/g, " ")}%,description.ilike.%${opts.search.replace(/[%_,()]/g, " ")}%`);
  const { data } = await q;
  return (data ?? []) as unknown as {
    id: string; folder_id: string; title: string; description: string | null; tags: string[]; current_file_id: string | null;
    current_version: number; uploaded_by: string; updated_by: string | null; updated_at: string;
    files: { file_name: string; mime_type: string; size_bytes: number } | null;
  }[];
}

export const SCOPE_LABEL: Record<string, string> = {
  organization: "Company",
  department: "Department",
  team: "Team",
  personal: "Personal",
  hr: "HR (confidential)",
};
