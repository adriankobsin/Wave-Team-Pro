import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** A photo or PDF on a project log entry: the viewer's own session must see the row (RLS), then a short-lived link. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!z.uuid().safeParse(file).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: row } = await supabase.from("project_note_files").select("storage_path, file_name").eq("id", file).maybeSingle();
  if (!row) return new NextResponse("Not found", { status: 404 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data } = await createAdminClient().storage.from("files").createSignedUrl(row.storage_path, 120, download ? { download: row.file_name } : undefined);
  if (!data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.redirect(data.signedUrl, { status: 302 });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
