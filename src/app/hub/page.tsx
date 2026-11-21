import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { MapPin, Receipt, Timer, UserCheck, Users } from "lucide-react";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub, hubOverview, hubUpdates } from "@/server/services/hub";
import { ClockPanel } from "@/components/home/clock-panel";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { Badge, Panel, PanelHeader } from "@/components/ui/misc";
import { timeOf } from "@/lib/time";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Overview" };

const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toFixed(0)} ${cur}`;
  }
};
const when = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));

export default async function HubOverview() {
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const tz = profile.timezone;
  const [overview, updates] = await Promise.all([hubOverview(hub.companies), hubUpdates(hub.companies)]);
  const total = (k: "timesheetsWaiting" | "expensesWaiting") => overview.reduce((n, c) => n + c[k], 0);
  // People, not memberships: someone in three companies counts once.
  const activePeople = new Set(overview.flatMap((c) => c.activeIds));
  const people = {
    active: activePeople.size,
    inactive: new Set(overview.flatMap((c) => c.inactiveIds).filter((id) => !activePeople.has(id))).size,
    invited: new Set(overview.flatMap((c) => c.invitedEmails)).size,
  };
  const onClock = overview.reduce((n, c) => n + c.onClock.length, 0);
  const order = { in: 0, break: 1, out: 2 } as const;
  const attendance = overview.flatMap((c) => c.today.map((p) => ({ ...p, company: c.name })))
    .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  const localTime = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());

  return (
    <div className="space-y-6">
      <LiveRefresh table="attendance_events" channel="hub-attendance" />
      <header>
        <p className="text-sm text-ink-muted">{localTime}</p>
        <h1 className="mt-1 text-[1.75rem] font-semibold sm:text-4xl">{BRAND.hub}</h1>
        <p className="mt-1 text-ink-muted">
          {hub.companies.length} companies · {people.active} active staff · {onClock} clocked in now
        </p>
      </header>

      <ClockPanel tz={tz} hubHome={hub.home} shiftLine="Choose the company and project you’re working on, then clock in. Switch any time." />

      {attendance.length ? (
        <Panel id="attendance">
          <PanelHeader
            title="Today's attendance"
            description={`${onClock} clocked in${attendance.length > onClock ? ` · ${attendance.length - onClock} clocked out` : ""} · updates live`}
          />
          <ul className="divide-y divide-line">
            {attendance.map((p) => (
              <li key={`${p.userId}-${p.company}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${p.state === "in" ? "bg-ok" : p.state === "break" ? "bg-brass" : "bg-line"}`} />
                  <span className="min-w-0">
                    <span className="font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{p.company}{p.project ? ` · ${p.project}` : ""}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  {p.state === "in" ? <Badge tone="ok">Clocked in</Badge> : p.state === "break" ? <Badge tone="warn">On break</Badge> : <Badge>Clocked out</Badge>}
                  <span className="mt-0.5 block tabular text-ink-muted">
                    {p.inAt ? `In ${timeOf(p.inAt, p.tz)}` : ""}{p.outAt ? ` · Out ${timeOf(p.outAt, p.tz)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/hub/staff?status=active" className="block rounded-lg border border-line bg-panel p-4 hover:border-ink-muted/40">
          <p className="flex items-center gap-2 text-sm text-ink-muted"><Users className="size-4" aria-hidden />Staff</p>
          <p className="tabular mt-1 text-2xl font-semibold">{people.active}</p>
          <p className="text-xs text-ink-muted">{people.inactive} inactive · {people.invited} invited (not joined yet)</p>
        </Link>
        <Link href="#attendance" className="block rounded-lg border border-line bg-panel p-4 hover:border-ink-muted/40">
          <p className="flex items-center gap-2 text-sm text-ink-muted"><UserCheck className="size-4" aria-hidden />Clocked in now</p>
          <p className="tabular mt-1 text-2xl font-semibold">{onClock}</p>
        </Link>
        <Link href="/hub/timesheets#waiting" className={`block rounded-lg border bg-panel p-4 hover:border-ink-muted/40 ${total("timesheetsWaiting") ? "border-brass/60" : "border-line"}`}>
          <p className="flex items-center gap-2 text-sm text-ink-muted"><Timer className="size-4" aria-hidden />Timesheets to approve</p>
          <p className="tabular mt-1 text-2xl font-semibold">{total("timesheetsWaiting")}</p>
        </Link>
        <Link href="/hub/expenses?status=submitted" className={`block rounded-lg border bg-panel p-4 hover:border-ink-muted/40 ${total("expensesWaiting") ? "border-brass/60" : "border-line"}`}>
          <p className="flex items-center gap-2 text-sm text-ink-muted"><Receipt className="size-4" aria-hidden />Expenses to approve</p>
          <p className="tabular mt-1 text-2xl font-semibold">{total("expensesWaiting")}</p>
        </Link>
      </div>

      <Panel>
        <PanelHeader title="Companies" description="Open a company to manage its settings, roles and approvals." />
        <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {overview.map((c) => (
            <li key={c.id} className="bg-panel p-4">
              <Link href={`/o/${c.slug}`} className="font-semibold hover:underline">{c.name}</Link>
              <p className="flex items-center gap-1 text-xs text-ink-muted"><MapPin className="size-3" aria-hidden />{c.location}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-muted">Active staff</dt><dd className="tabular text-right">{c.active}</dd>
                <dt className="text-ink-muted">Inactive / invited</dt><dd className="tabular text-right">{c.inactive} / {c.invited}</dd>
                <dt className="text-ink-muted">Clocked in now</dt><dd className="tabular text-right">{c.onClock.length}</dd>
                <dt className="text-ink-muted">Timesheets waiting</dt><dd className="tabular text-right">{c.timesheetsWaiting}</dd>
                <dt className="text-ink-muted">Expenses waiting</dt>
                <dd className="tabular text-right">{c.expensesWaiting}{c.expensesWaiting ? ` · ${money(c.expensesWaitingTotal, c.currency)}` : ""}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link className="underline" href={`/hub/staff?company=${c.id}`}>Staff</Link>
                <Link className="underline" href={`/o/${c.slug}/approvals`}>Approvals</Link>
                <Link className="underline" href={`/o/${c.slug}/attendance`}>Attendance</Link>
                {c.can.settings ? <Link className="underline" href={`/o/${c.slug}/admin/settings`}>Settings</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div>
        <Panel>
          <PanelHeader title="Latest updates" action={<Link href="/hub/updates" className="text-sm underline">All updates</Link>} />
          {updates.length ? (
            <ul className="divide-y divide-line">
              {updates.slice(0, 8).map((u) => (
                <li key={`${u.kind}-${u.id}`} className="px-4 py-2.5 text-sm sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    {u.link ? <Link href={u.link} className={`min-w-0 hover:underline ${u.unread ? "font-semibold" : ""}`}>{u.title}</Link> : <span className={u.unread ? "font-semibold" : ""}>{u.title}</span>}
                    <span className="shrink-0 text-xs text-ink-muted">{when(u.at, tz)}</span>
                  </div>
                  <p className="truncate text-xs text-ink-muted">{u.company.name}{u.kind === "announcement" ? " · Announcement" : u.body ? ` · ${u.body}` : ""}</p>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-4 text-sm text-ink-muted sm:px-5">No updates yet.</p>}
        </Panel>
      </div>
    </div>
  );
}
