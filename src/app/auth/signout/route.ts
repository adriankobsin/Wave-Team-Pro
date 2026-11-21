import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const reason = request.nextUrl.searchParams.get("reason");
  const target = new URL("/login", request.url);
  if (reason === "deactivated") target.searchParams.set("error", "deactivated");
  return NextResponse.redirect(target, { status: 303 });
}

export const POST = signOut;
// GET is used only for the forced sign-out of deactivated accounts.
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("reason") !== "deactivated") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return signOut(request);
}
