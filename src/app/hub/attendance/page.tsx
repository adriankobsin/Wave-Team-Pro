import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "@/components/ui/link";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub, hubAttendanceDay } from "@/server/services/hub";
import { ClockPanel } from "@/components/home/clock-panel";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { addDays, isDateString, timeOf, todayIn, zoneCity } from "@/lib/time";

export const metadata: Metadata = { title: "Attendance" };

export default async function HubAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; company?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const tz = profile.timezone;
  const today = todayIn(tz);
  const date = isDateString(sp.date) && sp.date <= today ? sp.date : today;
  const company = hub.companies.some((c) => c.id === sp.company) ? sp.company! : "";
  const all = await hubAttendanceDay(hub.companies, date, tz);
  const sessions = all.filter((s) => !company || s.company.id === company);
  const inNow = sessions.filter((s) => !s.end);
  const total = Math.round(sessions.reduce((n, s) => n + s.hours, 0) * 100) / 100;
  const long = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const link = (d: string) => `?${new URLSearchParams({ date: d, ...(company ? { company } : {}) })}`;

  return (
    <div className="space-y-6">
      <LiveRefresh table="attendance_events" channel="hub-attendance-page" />
      <PageHeader title="Attendance" description="Clock-ins and clock-outs in every company. Times are shown in your time zone." />
      <ClockPanel tz={tz} hubHome={hub.home} shiftLine="Choose the company and project you’re working on, then clock in. Switch any time." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link className={buttonClass("secondary", "sm")} href={link(addDays(date, -1))} aria-label="Previous day"><ChevronLeft className="size-4" aria-hidden /></Link>
          <Link className={buttonClass("secondary", "sm")} href={link(today)}>Today</Link>
          {date < today ? <Link className={buttonClass("secondary", "sm")} href={link(addDays(date, 1))} aria-label="Next day"><ChevronRight className="size-4" aria-hidden /></Link> : null}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Date
            <input type="date" name="date" defaultValue={date} max={today} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2" />
          </label>
          <label className="text-sm">Company
            <select name="company" defaultValue={company} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
              <option value="">All companies</option>
              {hub.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>Show</button>
        </form>
      </div>

      <Panel className="overflow-x-auto">
        <PanelHeader title={long} description={`${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${inNow.length} still clocked in · ${total.toFixed(2)} h worked`} />
        {sessions.length ? (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Company</th>
                <th className="px-2 py-2 font-medium">Project</th>
                <th className="px-2 py-2 text-right font-medium">In</th>
                <th className="px-2 py-2 text-right font-medium">Out</th>
                <th className="px-2 py-2 text-right font-medium">Break</th>
                <th className="px-4 py-2 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={`${s.userId}-${s.start}-${i}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-2 py-2 text-ink-muted">{s.company.name}</td>
                  <td className="px-2 py-2 text-ink-muted">{s.project ?? "—"}<span className="block text-xs">{zoneCity(s.tz)} time</span></td>
                  <td className="tabular px-2 py-2 text-right">{timeOf(s.start, s.tz)}</td>
                  <td className="tabular px-2 py-2 text-right">{s.end ? timeOf(s.end, s.tz) : <Badge tone="ok">Clocked in</Badge>}</td>
                  <td className="tabular px-2 py-2 text-right text-ink-muted">{s.breakMinutes ? `${s.breakMinutes} m` : "—"}</td>
                  <td className="tabular px-4 py-2 text-right">{s.hours.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title="Nobody clocked in on this day" />}
      </Panel>
    </div>
  );
}
