import Link from "@/components/ui/link";
import { Hash, Lock, Users } from "lucide-react";
import type { InboxItem } from "@/server/services/chat";
import type { DirectoryPerson } from "@/server/services/people";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function when(iso: string, tz: string) {
  const d = new Date(iso);
  const sameDay = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeZone: tz }).format(d) ===
    new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeZone: tz }).format(new Date());
  return new Intl.DateTimeFormat("en-GB", sameDay ? { hour: "2-digit", minute: "2-digit", timeZone: tz } : { day: "numeric", month: "short", timeZone: tz }).format(d);
}

export function conversationTitle(c: Pick<InboxItem, "type" | "name" | "other_user">, people: Map<string, DirectoryPerson>) {
  if (c.type === "direct") return people.get(c.other_user ?? "")?.name ?? "Former colleague";
  return c.type === "channel" ? `#${c.name}` : (c.name ?? "Group");
}

export function Inbox({ items, people, base, activeId, timeZone }: { items: InboxItem[]; people: Map<string, DirectoryPerson>; base: string; activeId?: string; timeZone: string }) {
  if (!items.length) return <p className="p-4 text-sm text-ink-muted">No conversations yet. Start one below.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => {
        const other = c.other_user ? people.get(c.other_user) : undefined;
        const title = conversationTitle(c, people);
        const author = c.last_author ? people.get(c.last_author)?.name.split(" ")[0] : null;
        return (
          <li key={c.id}>
            <Link
              href={`${base}/chat/${c.id}`}
              aria-current={activeId === c.id ? "page" : undefined}
              className={cn("flex items-center gap-3 px-4 py-3 hover:bg-panel-sunk", activeId === c.id && "bg-panel-sunk")}
            >
              {c.type === "direct" ? (
                <Avatar id={c.other_user ?? c.id} name={title} src={other?.avatarUrl} size="md" inactive={other ? other.status !== "active" : true} />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-panel-sunk text-ink-muted" aria-hidden>
                  {c.type === "channel" ? <Hash className="size-4" /> : <Users className="size-4" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate", c.unread_count ? "font-semibold" : "font-medium")}>{title}</span>
                  <span className="shrink-0 text-xs text-ink-muted tabular">{when(c.last_message_at, timeZone)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-ink-muted">
                    {c.last_body ? `${author && c.type !== "direct" ? `${author}: ` : ""}${c.last_body}` : c.type === "direct" ? "Say hello" : (c.topic ?? "")}
                  </span>
                  {c.unread_count ? (
                    <span className="rounded-full bg-brass px-1.5 text-xs font-semibold text-[#1c140a] tabular" aria-label={`${c.unread_count} unread`}>
                      {c.unread_count}
                    </span>
                  ) : c.type === "direct" ? <Lock className="size-3 text-ink-muted/60" aria-label="Private" /> : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
