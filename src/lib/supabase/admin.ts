import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use only for:
 *  - Supabase Auth admin operations (invite, ban),
 *  - writing avatar objects after server-side image processing,
 *  - the rate limiter.
 * Callers must authenticate and authorize the user *before* using it.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
