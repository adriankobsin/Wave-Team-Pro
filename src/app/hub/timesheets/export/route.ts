import { NextResponse, type NextRequest } from "next/server";
import { getMyProfile } from "@/lib/auth/session";
import { getHub, hubTimesheets } from "@/server/services/hub";
import { hubWeekPdf, hubWeekWorkbook } from "@/server/services/hub-export";
import { getLogo } from "@/server/services/branding";
import { isDateString, todayIn, weekStart } from "@/lib/time";

export async function GET(req: NextRequest) {
  const [profile, hub] = await Promise.all([getMyProfile(), getHub()]);
  if (!profile || !hub) return new NextResponse("Not found", { status: 404 });
  const w = req.nextUrl.searchParams.get("week");
  const week = weekStart(isDateString(w) ? w : todayIn(profile.timezone));
  const pdf = req.nextUrl.searchParams.get("format") === "pdf";
  const [rows, logo] = await Promise.all([hubTimesheets(hub.companies, week), hub.home ? getLogo(hub.home.id) : Promise.resolve(null)]);
  const body = pdf ? await hubWeekPdf(rows, week, logo) : await hubWeekWorkbook(rows, week, logo);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="group-timesheets-${week}.${pdf ? "pdf" : "xlsx"}"`,
      "cache-control": "private, no-store",
    },
  });
}
