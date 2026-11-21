"use client";

import { useEffect } from "react";

/**
 * If Supabase falls back to the site root (e.g. redirect URL not allow-listed), the sign-in
 * tokens arrive in the URL fragment of whatever page loads. Forward them to the callback.
 */
export function AuthHashForwarder() {
  useEffect(() => {
    const h = window.location.hash;
    if (!window.location.pathname.startsWith("/auth/callback") && /(^|[#&])(access_token|error_description)=/.test(h)) {
      window.location.replace(`/auth/callback${h}`);
    }
  }, []);
  return null;
}
