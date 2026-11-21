import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Creates 1-hour signed URLs for avatar objects using the *viewer's* session, so storage
 * RLS decides whether each URL may be issued. Unauthorized paths simply get no URL.
 */
export async function signAvatarPaths(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("avatars").createSignedUrls(unique, 3600);
  for (const item of data ?? []) {
    if (item.signedUrl && item.path && !item.error) out.set(item.path, item.signedUrl);
  }
  return out;
}
