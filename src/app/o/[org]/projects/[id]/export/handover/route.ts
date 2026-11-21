import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/errors";
import { getProjectLogo } from "@/server/services/branding";
import { PARTS, SCOPES, type PartKey, type ScopeKey } from "@/lib/handover/build";
import { buildProjectHandover } from "@/server/services/handover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The client handover document (PDF). ?by=system|area &tick=1 (pre-tick from status) &client=Name. Project managers and super admins only. */
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
  if (!canEdit) return new NextResponse("Only project managers and super admins can export the handover document.", { status: 403 });
  if (!(await consumeRateLimit(["project-handover", ctx.userId], 30, 3600))) return new NextResponse("Download limit reached. Try again in an hour.", { status: 429 });
  const q = req.nextUrl.searchParams;
  const parts: Partial<Record<PartKey, boolean>> = {};
  const off = new Set(q.getAll("off"));
  for (const k of PARTS) if (off.has(k)) parts[k] = false;
  const scope = q.getAll("scope").filter((k): k is ScopeKey => k in SCOPES);
  const only = q.getAll("sys").map((x) => x.slice(0, 80)).slice(0, 200);
  try {
    const out = await buildProjectHandover(id, { signBy: q.get("by") === "area" ? "area" : "system", preTick: q.get("tick") === "1", client: (q.get("client") ?? "").slice(0, 120), scope, parts, only }, await getProjectLogo(id), ctx.profile.timezone);
    if (!out) return new NextResponse("Not found", { status: 404 });
    if (!out.count) return new NextResponse("No devices to include. Add them on the Devices page, or tick at least one system.", { status: 400 });
    return new NextResponse(new Uint8Array(out.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${out.name}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    logServerError("project.handover", e);
    return new NextResponse("The handover document couldn't be made. Try again.", { status: 500 });
  }
}
