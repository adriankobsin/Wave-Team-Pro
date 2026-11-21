import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { getLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

/** The company logo for signed-in members. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const logo = await getLogo(ctx.org.id);
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.png), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
