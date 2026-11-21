import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The live version's id; open tabs compare it with their own and reload when it changed. */
export function GET() {
  return NextResponse.json(
    { id: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
