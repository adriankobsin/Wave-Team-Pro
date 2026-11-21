import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StoredAttachment } from "@/server/services/outlook";

/** Attachment of an invite or update: anyone who can see the invite (row-level security) may download it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const i = Number(n);
  if (!z.uuid().safeParse(id).success || !Number.isInteger(i) || i < 0) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("calendar_broadcasts").select("attachments").eq("id", id).maybeSingle();
  const file = ((data?.attachments ?? []) as StoredAttachment[])[i];
  if (!file) return new NextResponse("Not found", { status: 404 });
  const { data: signed } = await createAdminClient().storage.from("files").createSignedUrl(file.path, 120, { download: file.name });
  if (!signed?.signedUrl) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.redirect(signed.signedUrl, { status: 302 });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
