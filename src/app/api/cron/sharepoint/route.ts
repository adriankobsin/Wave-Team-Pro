import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { runSharepointUploads, scheduleSharepointPeriodics } from "@/server/services/sharepoint";
import { runOutlookSync } from "@/server/services/outlook";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily (vercel.json): queue weekly/monthly files, upload everything waiting, and retry Outlook invites. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  await scheduleSharepointPeriodics();
  const stats = await runSharepointUploads({ budgetMs: 200_000, limit: 1000 });
  const outlook = await runOutlookSync(200);
  return NextResponse.json({ ok: true, ...stats, outlook });
}
