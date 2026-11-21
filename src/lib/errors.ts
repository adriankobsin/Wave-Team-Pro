/** Result shape returned by every Server Action. Never throws raw database errors to the client. */
export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type PgLikeError = { code?: string; message?: string; details?: string | null; hint?: string | null };

/**
 * Maps a PostgREST/Postgres error to a user-safe message. Messages raised by our own
 * guards (errcode 42501/23514/22023/0A000) are written for end users and passed through;
 * everything else becomes a generic message (details are logged server-side).
 */
export function friendlyDbError(error: PgLikeError | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  const msg = error.message ?? "";
  if (code === "23505") return "That already exists.";
  if (code === "23503") return msg.includes("same organization") ? msg : "A related record no longer exists.";
  if (code === "42501") {
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    return msg;
  }
  if (["23514", "22023", "0A000", "P0002"].includes(code)) return msg;
  if (code === "PGRST116") return "Not found.";
  return fallback;
}

export function logServerError(scope: string, error: unknown) {
  // Structured, without request bodies or tokens.
  const e = error as PgLikeError & { name?: string };
  console.error(JSON.stringify({ level: "error", scope, code: e?.code, name: e?.name, message: e?.message }));
}
