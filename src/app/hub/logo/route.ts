import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getPlatformLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

/** Group Hub's logo, for signed-in people. */
export async function GET() {
  if (!(await getSessionUser())) return new NextResponse(null, { status: 401 });
  const logo = await getPlatformLogo();
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.png), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
