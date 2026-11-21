import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

/**
 * Fixed-window limiter backed by Postgres (works across serverless instances).
 * Keys are salted SHA-256 hashes so no emails or IPs are stored. If the limiter itself is
 * unavailable the request is allowed and the failure logged; Supabase Auth's own rate
 * limits still apply to sign-in and recovery.
 */
export async function consumeRateLimit(parts: string[], limit: number, windowSeconds: number): Promise<boolean> {
  const { RATE_LIMIT_SALT } = serverEnv();
  const keyHash = createHash("sha256").update(`${RATE_LIMIT_SALT}|${parts.join("|").toLowerCase()}`).digest("hex");
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", scope: "rate-limit", code: error.code }));
    return true;
  }
  return data === true;
}
