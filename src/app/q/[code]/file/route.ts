import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/errors";
import { buildQrDoc } from "@/server/services/qr-doc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What scanning a QR sticker opens: a PDF of that rack, patch panel, switch, lighting panel or
 * project, made from the live schedules at that moment (a drawing opens as its marked-up PDF).
 * Sign-in and access to the project are still required; `qr_links` is read with the scanner's session.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/q/${code}`)}`, req.url));
  if (!/^[a-z0-9]{8}$/.test(code)) return NextResponse.redirect(new URL(`/q/${code}?missing=1`, req.url));
  const { data: link } = await supabase.from("qr_links").select("project_id, target, organizations(slug)").eq("code", code).maybeSingle();
  const slug = (link?.organizations as unknown as { slug: string } | null)?.slug;
  if (!link || !slug) return NextResponse.redirect(new URL(`/q/${code}?missing=1`, req.url));
  if (!(await consumeRateLimit(["qr-doc", userId], 120, 3600))) return new NextResponse("Too many labels opened in a short time. Try again in a few minutes.", { status: 429 });

  const live = `/o/${slug}/projects/${link.project_id}${link.target}`;
  try {
    const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    const doc = await buildQrDoc(link.project_id as string, link.target as string, new URL(live, req.url).toString(), (profile?.timezone as string | null) ?? "UTC");
    if (!doc) return NextResponse.redirect(new URL(`/q/${code}?missing=1`, req.url));
    if (doc.kind === "drawing") return NextResponse.redirect(new URL(`/o/${slug}/projects/${link.project_id}/drawings/${doc.id}/export?inline=1`, req.url));
    const name = doc.name.replace(/[^\w .,()&+-]/g, "_");
    return new NextResponse(new Uint8Array(doc.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    logServerError("qr.doc", e);
    return new NextResponse("The PDF for this label couldn't be made. Try again, or open the project online.", { status: 500 });
  }
}
