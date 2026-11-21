import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { runM365Sync } from "@/server/services/m365-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every 15 minutes (vercel.json): mirrors project tasks, log and dates into Microsoft 365 for companies that switched it on. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const summary = await runM365Sync({ budgetMs: 240_000 });
  return NextResponse.json(summary);
}
