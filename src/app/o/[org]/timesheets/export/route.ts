import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isDateString, todayIn, weekStart } from "@/lib/time";
import { buildPersonWeek, personWeekPdf, personWeekWorkbook } from "@/server/services/person-week";
import { getLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

/** One person's week as Excel or PDF: this company only (scope=company) or every company the viewer may see (scope=all). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!(await consumeRateLimit(["timesheet-export", ctx.userId], 60, 3600))) return new NextResponse("Download limit reached. Try again later.", { status: 429 });
  const sp = req.nextUrl.searchParams;
  const week = weekStart(isDateString(sp.get("week")) ? sp.get("week")! : todayIn(ctx.profile.timezone));
  const person = /^[0-9a-f-]{36}$/.test(sp.get("person") ?? "") ? sp.get("person")! : ctx.userId;
  const scope = sp.get("scope") === "company" ? "company" : "all";
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const w = await buildPersonWeek(await createClient(), person, week, scope === "company" ? ctx.org.id : undefined);
  if (!w || !w.companies.length) return new NextResponse("You can't see this person's timesheet.", { status: 404 });
  const name = `timesheet-${w.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "employee"}-${week}${scope === "company" ? `-${ctx.org.slug}` : "-all-companies"}`;
  const logo = await getLogo(ctx.org.id);
  const body = format === "pdf" ? await personWeekPdf(w, logo) : await personWeekWorkbook(w, logo);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.${format}"`,
      "cache-control": "private, no-store",
    },
  });
}
