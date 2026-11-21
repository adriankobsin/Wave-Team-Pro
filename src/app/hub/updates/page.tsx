import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { Bell, Megaphone } from "lucide-react";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub, hubUpdates } from "@/server/services/hub";
import { markAllNotificationsRead } from "@/server/actions/notifications";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Updates" };

export default async function HubUpdatesPage({ searchParams }: { searchParams: Promise<{ company?: string; unread?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const company = hub.companies.some((c) => c.id === sp.company) ? sp.company : undefined;
  const unreadOnly = sp.unread === "1";
  const updates = await hubUpdates(hub.companies, { companyId: company, unreadOnly });
  const unread = updates.filter((u) => u.unread).length;
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: profile.timezone });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Updates"
        description="Notifications and announcements from every company: clock-ins, submitted timesheets, expense claims, leave requests and more."
        actions={unread ? (
          <ActionForm action={markAllNotificationsRead}>
            <SubmitButton variant="secondary" pendingLabel="…">Mark all as read</SubmitButton>
          </ActionForm>
        ) : null}
      />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Company
          <select name="company" defaultValue={company ?? ""} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="">All companies</option>
            {hub.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} /> Unread only
        </label>
        <button type="submit" className={buttonClass("secondary")}>Show</button>
      </form>
      <Panel>
        {updates.length ? (
          <ul className="divide-y divide-line">
            {updates.map((u) => {
              const Icon = u.kind === "announcement" ? Megaphone : Bell;
              return (
                <li key={`${u.kind}-${u.id}`} className="flex gap-3 px-4 py-3 sm:px-5">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${u.unread ? "text-brass" : "text-ink-muted"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      {u.link ? <Link href={u.link} className={`hover:underline ${u.unread ? "font-semibold" : ""}`}>{u.title}</Link> : <span className={u.unread ? "font-semibold" : ""}>{u.title}</span>}
                      <span className="text-xs text-ink-muted">{fmt.format(new Date(u.at))}</span>
                    </div>
                    {u.body ? <p className="text-sm text-ink-muted">{u.body}</p> : null}
                    <p className="mt-0.5 flex gap-2 text-xs text-ink-muted">
                      <span>{u.company.name}</span>
                      {u.kind === "announcement" ? <Badge>Announcement</Badge> : null}
                      {u.unread ? <Badge tone="warn">New</Badge> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState title={unreadOnly ? "You're all caught up" : "No updates yet"} />}
      </Panel>
    </div>
  );
}
