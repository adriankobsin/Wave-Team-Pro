import Link from "@/components/ui/link";
import { CalendarDays, CheckSquare, Clock, MessageSquare, Receipt, Megaphone, Sun, Timer, ShieldCheck } from "lucide-react";
import type { OrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { ClockPanel } from "@/components/home/clock-panel";
import { getHub } from "@/server/services/hub";
import { Badge, Panel, PanelHeader } from "@/components/ui/misc";
import { timeOf, todayIn, weekStart, addDays } from "@/lib/time";
import { cn } from "@/lib/utils";

function Tile({ href, icon: Icon, label, value, sub, tone }: { href: string; icon: typeof Clock; label: string; value: string; sub?: string; tone?: "attention" }) {
  return (
    <Link href={href} className={cn("block rounded-lg border bg-panel p-4 transition-colors hover:border-ink-muted/40", tone === "attention" ? "border-brass/60" : "border-line")}>
      <p className="flex items-center gap-2 text-sm text-ink-muted"><Icon className="size-4" aria-hidden />{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-xs text-ink-muted">{sub}</p> : null}
    </Link>
  );
}

/** Personal dashboard: what needs the person's attention today. */
export async function Today({ ctx }: { ctx: OrgContext }) {
  const supabase = await createClient();
  const p = ctx.perms;
  const tz = ctx.profile.timezone;
  const today = todayIn(tz);
  const base = `/o/${ctx.org.slug}`;
  const dayStart = new Date(Date.parse(`${addDays(today, -1)}T00:00:00Z`)).toISOString();
  const dayEnd = new Date(Date.parse(`${addDays(today, 2)}T00:00:00Z`)).toISOString();

  const hub = await getHub();
  const [, { data: shifts }, { data: myTasks }, { data: balances }, { data: inbox }, { data: news }, { count: expenseTodo }, { data: sheet }, { data: approvals }, { data: expenseApprovals }] = await Promise.all([
    Promise.resolve(null),
    supabase.from("shifts").select("starts_at, ends_at, location").eq("membership_id", ctx.membership.id).gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
    supabase.from("task_assignees").select("tasks!inner(id, title, status, due_date, archived_at)").eq("user_id", ctx.userId).neq("tasks.status", "done").is("tasks.archived_at", null),
    p.hasAnyScope("leave.request") ? supabase.rpc("leave_balances", { p_org: ctx.org.id, p_membership: ctx.membership.id, p_year: Number(today.slice(0, 4)) }) : Promise.resolve({ data: [] }),
    supabase.rpc("my_conversations", { p_org: ctx.org.id }),
    supabase.from("announcements").select("id, title, published_at, pinned").eq("organization_id", ctx.org.id).is("archived_at", null).order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(3),
    p.has("expenses.create") ? supabase.from("expenses").select("id", { count: "exact", head: true }).eq("membership_id", ctx.membership.id).in("status", ["draft", "rejected"]) : Promise.resolve({ count: 0 }),
    p.hasAnyScope("timesheets.submit") ? supabase.from("timesheets").select("status").eq("membership_id", ctx.membership.id).eq("week_start", weekStart(today)).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("my_approval_counts", { p_org: ctx.org.id }),
    supabase.rpc("my_expense_approval_count", { p_org: ctx.org.id }),
  ]);
  const tasks = ((myTasks ?? []) as unknown as { tasks: { id: string; title: string; status: string; due_date: string | null } }[]).map((t) => t.tasks);
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today).length;
  const dueSoon = tasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7)).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const annual = ((balances ?? []) as { name: string; remaining: number | null }[]).find((b) => b.remaining !== null);
  const unread = ((inbox ?? []) as { unread_count: number; muted: boolean }[]).reduce((n, c) => n + (c.muted ? 0 : Number(c.unread_count)), 0);
  const ac = ((approvals ?? []) as { timesheets: number; leave: number; corrections: number }[])[0];
  const pendingApprovals = (ac ? Number(ac.timesheets) + Number(ac.leave) + Number(ac.corrections) : 0) + Number(expenseApprovals ?? 0);
  const shift = ((shifts ?? []) as { starts_at: string; ends_at: string; location: string | null }[]).find((s) => todayIn(tz, new Date(s.starts_at)) === today);
  const sheetStatus = (sheet as { status?: string } | null)?.status;

  return (
    <div className="space-y-6">
      <ClockPanel tz={tz} orgId={ctx.org.id} hubHome={hub?.home} shiftLine={shift ? `Shift ${timeOf(shift.starts_at, tz)}–${timeOf(shift.ends_at, tz)}${shift.location ? ` · ${shift.location}` : ""}` : "No shift scheduled today"} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href={`${base}/tasks`} icon={CheckSquare} label="My open tasks" value={String(tasks.length)} sub={overdue ? `${overdue} overdue` : dueSoon.length ? `${dueSoon.length} due this week` : "Nothing due this week"} tone={overdue ? "attention" : undefined} />
        <Tile href={`${base}/chat`} icon={MessageSquare} label="Unread messages" value={String(unread)} tone={unread ? "attention" : undefined} />
        {annual ? <Tile href={`${base}/leave`} icon={Sun} label={annual.name} value={`${Number(annual.remaining)} d`} sub="remaining this year" /> : null}
        {p.has("expenses.create") ? <Tile href={`${base}/expenses`} icon={Receipt} label="Expenses to finish" value={String(expenseTodo ?? 0)} sub="drafts and returned claims" tone={expenseTodo ? "attention" : undefined} /> : null}
        {p.hasAnyScope("timesheets.submit") ? <Tile href={`${base}/timesheets`} icon={Timer} label="This week’s timesheet" value={sheetStatus === "submitted" ? "Submitted" : sheetStatus === "approved" ? "Approved" : sheetStatus === "rejected" ? "Returned" : "Not submitted"} tone={sheetStatus === "rejected" ? "attention" : undefined} /> : null}
        {pendingApprovals ? <Tile href={`${base}/approvals`} icon={ShieldCheck} label="Waiting for your approval" value={String(pendingApprovals)} tone="attention" /> : null}
        <Tile href={`${base}/schedule`} icon={CalendarDays} label="Schedule" value={shift ? timeOf(shift.starts_at, tz) : "—"} sub={shift ? "your shift today" : "see the team rota"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Due soon" action={<Link href={`${base}/tasks`} className="text-sm underline">All tasks</Link>} />
          {dueSoon.length || overdue ? (
            <ul className="divide-y divide-line">
              {[...tasks.filter((t) => t.due_date && t.due_date < today), ...dueSoon].slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <Link href={`${base}/tasks/${t.id}`} className="min-w-0 truncate text-sm hover:underline">{t.title}</Link>
                  <Badge tone={t.due_date! < today ? "danger" : t.due_date === today ? "warn" : "neutral"}>{t.due_date! < today ? "Overdue" : t.due_date === today ? "Today" : t.due_date}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">Nothing due in the next 7 days.</p>}
        </Panel>
        <Panel>
          <PanelHeader title="Announcements" action={<Link href={`${base}/announcements`} className="text-sm underline">All</Link>} />
          {(news ?? []).length ? (
            <ul className="divide-y divide-line">
              {(news ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <Megaphone className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  <Link href={`${base}/announcements#a-${a.id}`} className="min-w-0 flex-1 truncate hover:underline">{a.title}</Link>
                  {a.pinned ? <Badge>Pinned</Badge> : null}
                </li>
              ))}
            </ul>
          ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">No announcements yet.</p>}
        </Panel>
      </div>
    </div>
  );
}
