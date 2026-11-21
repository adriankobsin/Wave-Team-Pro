"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/link";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

const TYPES = ["invite", "recovery", "email", "email_change", "signup", "magiclink"];

function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/auth/set-password";
}

/**
 * Completes every link format Supabase can send: tokens in the URL fragment (default
 * email templates), a token_hash in the query (custom templates) or a PKCE code.
 * The session is stored in cookies by the browser client, so the server sees it next.
 */
async function complete(): Promise<{ next?: string; error?: string }> {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const next = safeNext(url.searchParams.get("next"));
  // Dedicated client: we parse the URL ourselves, so automatic detection is off.
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    isSingleton: false,
    auth: { detectSessionInUrl: false },
  });

  const hashError = hash.get("error_description") ?? url.searchParams.get("error_description");
  if (hashError) return { error: hashError.replace(/\+/g, " ") };

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return { error: error.message };
    const type = hash.get("type");
    return { next: type === "invite" || type === "recovery" || type === "signup" ? "/auth/set-password" : next };
  }

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    return error ? { error: error.message } : { next };
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? { error: error.message } : { next };
  }

  const { data } = await supabase.auth.getSession();
  return data.session ? { next } : { error: "This link is incomplete." };
}

export function CallbackHandler() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    complete().then((r) => {
      if (cancelled) return;
      if (r.next) window.location.replace(r.next);
      else setError(r.error ?? "This link didn't work.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!error) {
    return (
      <div role="status">
        <h1 className="text-2xl font-semibold">Signing you in…</h1>
        <p className="mt-1 text-sm text-ink-muted">One moment while we check your link.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold">This link didn’t work</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Invitation and reset links can be used once and expire after a while. ({error})
      </p>
      <p className="mt-4 text-sm">
        Already set a password? <Link className="font-medium underline" href="/login">Sign in</Link>. Otherwise use{" "}
        <Link className="font-medium underline" href="/forgot-password">Forgot password</Link> with your work email, or ask your administrator to resend the invitation.
      </p>
    </div>
  );
}
