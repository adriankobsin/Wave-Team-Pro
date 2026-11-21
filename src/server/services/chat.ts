import "server-only";
import { createClient } from "@/lib/supabase/server";

export type InboxItem = {
  id: string;
  type: "direct" | "group" | "channel";
  name: string | null;
  topic: string | null;
  audience: string;
  team_id: string | null;
  last_message_at: string;
  unread_count: number;
  last_body: string | null;
  last_author: string | null;
  other_user: string | null;
  muted: boolean;
};

export async function getInbox(orgId: string): Promise<InboxItem[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations", { p_org: orgId });
  return ((data as InboxItem[] | null) ?? []).map((r) => ({ ...r, unread_count: Number(r.unread_count) }));
}

export type ChatMessage = {
  id: string;
  author_id: string;
  body: string;
  parent_id: string | null;
  pinned_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  attachments: { id: string; file_name: string; mime_type: string; size_bytes: number }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
};

export async function getConversation(conversationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, organization_id, type, name, topic, audience, team_id, archived_at, created_by")
    .eq("id", conversationId)
    .maybeSingle();
  return data;
}

export async function getConversationMembers(conversationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation_members")
    .select("user_id, role, last_read_at, muted")
    .eq("conversation_id", conversationId);
  return data ?? [];
}

export async function getMessages(conversationId: string, userId: string, opts: { before?: string; limit?: number; search?: string } = {}) {
  const supabase = await createClient();
  const limit = opts.limit ?? 60;
  let q = supabase
    .from("messages")
    .select("id, author_id, body, parent_id, pinned_at, edited_at, deleted_at, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (opts.before) q = q.lt("created_at", opts.before);
  if (opts.search) q = q.textSearch("body", opts.search, { type: "websearch", config: "simple" });
  const { data } = await q;
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const ids = page.map((m) => m.id);
  const [{ data: att }, { data: reacts }] = await Promise.all([
    ids.length
      ? supabase.from("message_attachments").select("message_id, files(id, file_name, mime_type, size_bytes)").in("message_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase.from("message_reactions").select("message_id, user_id, emoji").in("message_id", ids)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const messages: ChatMessage[] = page.map((m) => {
    const files = (att ?? [])
      .filter((a: { message_id: string }) => a.message_id === m.id)
      .map((a: { files: unknown }) => a.files as ChatMessage["attachments"][number])
      .filter(Boolean);
    const rs = (reacts ?? []).filter((r: { message_id: string }) => r.message_id === m.id) as { emoji: string; user_id: string }[];
    const grouped = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of rs) {
      const g = grouped.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      g.count += 1;
      if (r.user_id === userId) g.mine = true;
      grouped.set(r.emoji, g);
    }
    return { ...m, attachments: files, reactions: [...grouped.values()] };
  });
  return { messages, hasMore };
}

/**
 * Resolves "@First" / "@First Last" mentions in a message body to member user ids.
 * Only people who share the organization are matched.
 */
export function resolveMentions(body: string, people: { userId: string; name: string }[]): string[] {
  const found = new Set<string>();
  const lower = body.toLocaleLowerCase();
  for (const p of people) {
    const full = p.name.toLocaleLowerCase();
    const first = full.split(/\s+/)[0];
    if (lower.includes(`@${full}`) || new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(lower)) {
      found.add(p.userId);
    }
  }
  return [...found];
}
