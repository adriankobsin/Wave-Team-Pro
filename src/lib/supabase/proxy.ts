import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/", "/offline", "/manifest.webmanifest", "/icon.svg", "/api/cron/", "/api/version", "/.well-known/"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || (p.endsWith("/") && pathname.startsWith(p)));
}

/**
 * Refreshes the Supabase session cookie on every request and redirects anonymous users
 * to /login. Authorization is NOT decided here — pages and actions re-check the session
 * and RLS enforces data access.
 */
export async function updateSession(request: NextRequest) {
  // Each release also has its own permanent address (<project>-xxxx.vercel.app) frozen at that
  // version. Send page visits there to the live address so nobody gets stuck on an old copy.
  const live = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = request.headers.get("host") ?? "";
  if (process.env.VERCEL_ENV === "production" && live && host !== live && host.endsWith(".vercel.app") && request.method === "GET" && !request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `https://${live}`), 308);
  }
  // Email links that fall back to the Site URL (e.g. "/?code=…") are completed by the callback page.
  const sp = request.nextUrl.searchParams;
  if ((request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/login") &&
      (sp.has("code") || sp.has("token_hash") || sp.has("error_description"))) {
    const cb = new URL("/auth/callback", request.url);
    cb.search = request.nextUrl.search;
    return NextResponse.redirect(cb);
  }
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return isPublicPath(request.nextUrl.pathname)
      ? response
      : NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = (data?.claims?.sub as string | undefined) ?? null;
  } catch {
    userId = null; // Auth unreachable: treat as signed out rather than failing open.
  }

  const { pathname, search } = request.nextUrl;
  if (!userId && !isPublicPath(pathname)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(login);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}
