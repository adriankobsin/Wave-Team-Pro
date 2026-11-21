import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { buildReport, monthRange, reportWorkbook } from "@/server/services/reports";
import { consumeRateLimit } from "@/lib/rate-limit";
import { todayIn } from "@/lib/time";
import { getLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

const isMonth = (s: string | null) => Boolean(s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s));

export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.has("reports.export")) return new NextResponse("You don't have permission to export reports.", { status: 403 });
  if (!(await consumeRateLimit(["report-export", ctx.userId], 30, 3600))) return new NextResponse("Export limit reached. Try again later.", { status: 429 });
  const sp = req.nextUrl.searchParams;
  const from = isMonth(sp.get("from")) ? sp.get("from")! : todayIn(ctx.profile.timezone).slice(0, 7);
  const to = isMonth(sp.get("to")) ? sp.get("to")! : from;
  const r = await buildReport(ctx.org.id, monthRange(from, to));

  const buf = await reportWorkbook(ctx.org.name, r, undefined, await getLogo(ctx.org.id));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="report-${ctx.org.slug}-${from}${to !== from ? `_${to}` : ""}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
