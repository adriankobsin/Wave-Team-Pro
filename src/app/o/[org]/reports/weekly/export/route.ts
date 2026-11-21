import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { buildWeekly, weeklyPdf, weeklyWorkbook } from "@/server/services/weekly";
import { addDays, isDateString, todayIn, weekStart } from "@/lib/time";
import { getLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const p = ctx.perms;
  if (!(p.has("attendance.view.all") || p.hasAnyScope("attendance.view.team") || p.hasAnyScope("timesheets.approve") || p.hasAnyScope("reports.view"))) {
    return new NextResponse("Not allowed.", { status: 403 });
  }
  const w = req.nextUrl.searchParams.get("week");
  const wk = weekStart(isDateString(w) ? w : addDays(todayIn(ctx.profile.timezone), -7));
  const data = await buildWeekly(await createClient(), ctx.org.id, wk, ctx.org.timezone);
  const pdf = req.nextUrl.searchParams.get("format") === "pdf";
  const logo = await getLogo(ctx.org.id);
  const buf = pdf ? await weeklyPdf(ctx.org.name, wk, data, logo) : await weeklyWorkbook(ctx.org.name, wk, data, logo);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="weekly-timesheets-${ctx.org.slug}-${wk}.${pdf ? "pdf" : "xlsx"}"`,
      "cache-control": "private, no-store",
    },
  });
}
