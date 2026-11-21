import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/errors";
import { getProjectLogo } from "@/server/services/branding";
import { PACK_SECTIONS, buildProjectPack, type PackSection } from "@/server/services/project-pack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The branded project pack (PDF). Project managers and super admins only. ?s=cables,devices,… picks sections. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: project }, { data: canEdit }] = await Promise.all([
    supabase.from("projects").select("id, organization_id").eq("id", id).maybeSingle(),
    supabase.rpc("can_edit_project", { p_project: id }),
  ]);
  if (!project || project.organization_id !== ctx.org.id) return new NextResponse("Not found", { status: 404 });
  if (!canEdit) return new NextResponse("Only project managers and super admins can export the project pack.", { status: 403 });
  if (!(await consumeRateLimit(["project-pack", ctx.userId], 30, 3600))) return new NextResponse("Download limit reached. Try again in an hour.", { status: 429 });

  const known = new Set(PACK_SECTIONS.map(([k]) => k as string));
  const asked = req.nextUrl.searchParams.getAll("s").flatMap((v) => v.split(",")).filter((k) => known.has(k)) as PackSection[];
  const sections = new Set<PackSection>(asked.length ? asked : PACK_SECTIONS.map(([k]) => k));
  try {
    const pack = await buildProjectPack(id, sections, await getProjectLogo(id), ctx.profile.timezone);
    if (!pack) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(new Uint8Array(pack.bytes), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pack.name}"`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    logServerError("project.pack", e);
    return new NextResponse("The project pack couldn't be made. Try again with fewer sections (drawings are the largest part).", { status: 500 });
  }
}
