import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StoredAttachment } from "@/server/services/outlook";

/** A booking confirmation: anyone who can see the booking (row-level security) may download it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ booking: string; n: string }> }) {
  const { booking, n } = await params;
  const i = Number(n);
  if (!z.uuid().safeParse(booking).success || !Number.isInteger(i) || i < 0) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: b } = await supabase.from("travel_bookings").select("broadcast_id").eq("id", booking).maybeSingle();
  if (!b?.broadcast_id) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data } = await admin.from("calendar_broadcasts").select("attachments").eq("id", b.broadcast_id).maybeSingle();
  const file = ((data?.attachments ?? []) as StoredAttachment[])[i];
  if (!file) return new NextResponse("Not found", { status: 404 });
  const { data: signed } = await admin.storage.from("files").createSignedUrl(file.path, 120, { download: file.name });
  if (!signed?.signedUrl) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.redirect(signed.signedUrl, { status: 302 });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
