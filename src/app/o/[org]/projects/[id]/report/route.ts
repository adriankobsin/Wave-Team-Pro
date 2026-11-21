import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getProjectLogo } from "@/server/services/branding";
import { loadProjectReport, projectReportPdf, projectReportWorkbook } from "@/server/services/project-report";

export const dynamic = "force-dynamic";

/** Project management report (Excel or PDF): summary, tasks with reports, project log, hours, expenses. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: canEdit } = await supabase.rpc("can_edit_project", { p_project: id });
  if (!canEdit) {
    return new NextResponse("You don't have permission to download this report.", { status: 403 });
  }
  if (!(await consumeRateLimit(["project-report", ctx.userId], 60, 3600))) return new NextResponse("Download limit reached. Try again later.", { status: 429 });
  const r = await loadProjectReport(id, ctx.profile.timezone);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const pdf = req.nextUrl.searchParams.get("format") === "pdf";
  const logo = await getProjectLogo(id);
  const body = pdf ? await projectReportPdf(r, logo) : await projectReportWorkbook(r, logo);
  const file = `${(r.project.code || r.project.name).replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40)}-report-${r.generated.slice(0, 10)}.${pdf ? "pdf" : "xlsx"}`;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "private, no-store",
    },
  });
}
