import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { signedFileUrl } from "@/server/services/files";

/**
 * Permission-checked file access. The viewer's session asks for the files row (RLS) and a
 * short-lived signed URL (storage RLS), then we redirect. Links in pages never expire and
 * never grant access on their own.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const signed = await signedFileUrl(id, { download, seconds: 120 });
  if (!signed) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.redirect(signed.url, { status: 302 });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
