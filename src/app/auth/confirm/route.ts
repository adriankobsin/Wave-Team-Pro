import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

const TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change", "signup", "magiclink"];

/** Verifies email links (invite, recovery, confirmation) using the token hash flow. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"), "/");

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  if (tokenHash) return NextResponse.redirect(new URL("/login?error=link", request.url));
  // Default Supabase templates put the session in the URL fragment, which only the browser
  // can read. The fragment survives this redirect.
  const cb = new URL("/auth/callback", request.url);
  cb.search = url.search;
  return NextResponse.redirect(cb);
}
