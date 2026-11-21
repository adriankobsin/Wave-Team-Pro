import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { markNotificationsRead } from "@/server/actions/notifications";
import { InlineActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { formatDateTime } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("notifications").select("id, kind, title, body, link, actor_id, read_at, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(100),
    listPeople(ctx.org.id, { includeInactive: true }),
  ]);
  const byId = new Map(people.map((p) => [p.userId, p]));
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="mx-auto max-w-3xl">
      <LiveRefresh table="notifications" channel={`notif-page-${ctx.userId}`} filter={`user_id=eq.${ctx.userId}`} />
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up."}
        actions={unread ? (
          <InlineActionForm action={markNotificationsRead}>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <SubmitButton variant="secondary" size="sm">Mark all as read</SubmitButton>
          </InlineActionForm>
        ) : null}
      />
      <Panel>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const actor = n.actor_id ? byId.get(n.actor_id) : undefined;
              return (
                <li key={n.id} className={n.read_at ? "" : "bg-brass-soft/30"}>
                  <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <Avatar id={n.actor_id ?? n.id} name={actor?.name ?? BRAND.group} src={actor?.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <p className="font-medium">{n.title}</p>}
                      {n.body ? <p className="truncate text-sm text-ink-muted">{n.body}</p> : null}
                      <p className="text-xs text-ink-muted">{formatDateTime(n.created_at, ctx.profile.timezone)}</p>
                    </div>
                    {!n.read_at ? (
                      <InlineActionForm action={markNotificationsRead}>
                        <input type="hidden" name="organization_id" value={ctx.org.id} />
                        <input type="hidden" name="notification_id" value={n.id} />
                        <button type="submit" className="text-xs text-ink-muted underline">Mark read</button>
                      </InlineActionForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No notifications yet">Mentions, direct messages, approvals and announcements will show here.</EmptyState>
        )}
      </Panel>
    </div>
  );
}
