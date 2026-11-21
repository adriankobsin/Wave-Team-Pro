import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { addDays, addMonths, daysInMonth, isoWeekday, minutesByDayZoned, projectSessionsFrom, type ProjectPunch } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";
import { classifyDay, DAY_STYLE, type DayKind, type LeaveOnDay } from "@/lib/attendance-calendar";
import { buttonClass } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const LEGEND: DayKind[] = ["worked", "absent", "sick", "annual", "other_leave", "pending_leave", "holiday", "day_off", "today", "future"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hm(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`;
}

/** Month view of one person's attendance, leave and holidays, colour-coded with a legend. */
export async function AttendanceCalendar({
  orgId, membershipId, month, tz, today, joined, title, hrefFor,
}: {
  orgId: string; membershipId: string; month: string; tz: string; today: string; joined: string | null; title: string;
  hrefFor: (month: string) => string;
}) {
  const first = month; // YYYY-MM-01
  const n = daysInMonth(first);
  const last = addDays(first, n - 1);
  const supabase = await createClient();
  const [{ data: punches }, { data: sheets }, { data: leave }, { data: types }, { data: holidays }, { data: shifts }] = await Promise.all([
    supabase.from("attendance_events").select("kind, occurred_at, project_id").eq("membership_id", membershipId)
      .gte("occurred_at", new Date(Date.parse(`${addDays(first, -1)}T00:00:00Z`)).toISOString())
      .lt("occurred_at", new Date(Date.parse(`${addDays(last, 2)}T00:00:00Z`)).toISOString()).order("occurred_at"),
    supabase.from("timesheets").select("id").eq("membership_id", membershipId).gte("week_start", addDays(first, -6)).lte("week_start", last),
    supabase.from("leave_requests").select("leave_type_id, start_date, end_date, status").eq("membership_id", membershipId)
      .in("status", ["approved", "pending"]).lte("start_date", last).gte("end_date", first),
    supabase.from("leave_types").select("id, name").eq("organization_id", orgId),
    supabase.from("public_holidays").select("holiday_date, name").eq("organization_id", orgId).gte("holiday_date", first).lte("holiday_date", last),
    supabase.from("shifts").select("starts_at").eq("membership_id", membershipId)
      .gte("starts_at", new Date(Date.parse(`${first}T00:00:00Z`)).toISOString()).lt("starts_at", new Date(Date.parse(`${addDays(last, 1)}T00:00:00Z`)).toISOString()),
  ]);
  const sheetIds = (sheets ?? []).map((s) => s.id);
  const { data: entries } = sheetIds.length
    ? await supabase.from("timesheet_entries").select("work_date, hours").in("timesheet_id", sheetIds).gte("work_date", first).lte("work_date", last)
    : { data: [] as { work_date: string; hours: number }[] };

  // Each day is counted in the zone of the project it was worked on.
  const sessions = projectSessionsFrom((punches ?? []) as ProjectPunch[]);
  const worked = minutesByDayZoned(sessions, await projectZones(supabase, sessions.map((x) => x.projectId)), tz);
  const logged: Record<string, number> = {};
  for (const e of entries ?? []) logged[e.work_date] = (logged[e.work_date] ?? 0) + Number(e.hours);
  const typeName = new Map((types ?? []).map((t) => [t.id, t.name]));
  const leaveOn = new Map<string, LeaveOnDay>();
  for (const l of leave ?? []) {
    for (let d = l.start_date < first ? first : l.start_date; d <= l.end_date && d <= last; d = addDays(d, 1)) {
      const prev = leaveOn.get(d);
      if (!prev || (prev.status === "pending" && l.status === "approved")) leaveOn.set(d, { type: typeName.get(l.leave_type_id) ?? "Leave", status: l.status as LeaveOnDay["status"] });
    }
  }
  const holidayOn = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name]));
  const scheduled = new Set((shifts ?? []).map((s) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(s.starts_at))));

  const days = Array.from({ length: n }, (_, i) => addDays(first, i)).map((date) => {
    const kind = classifyDay({
      date, today, joined, workedMinutes: worked[date] ?? 0, loggedHours: logged[date] ?? 0,
      leave: leaveOn.get(date) ?? null, holiday: holidayOn.get(date) ?? null, scheduled: scheduled.has(date),
    });
    const mins = Math.max(worked[date] ?? 0, Math.round((logged[date] ?? 0) * 60));
    const detail = [DAY_STYLE[kind].label, leaveOn.get(date)?.type, holidayOn.get(date), mins ? hm(mins) : null].filter(Boolean).join(" · ");
    return { date, kind, mins, detail };
  });
  const count = (k: DayKind) => days.filter((d) => d.kind === k).length;
  const totalMins = days.reduce((s, d) => s + d.mins, 0);
  const lead = isoWeekday(first) - 1;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T00:00:00Z`));

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={`${monthLabel} · ${count("worked")} days worked (${hm(totalMins)}) · ${count("absent")} absent · ${count("sick")} sick · ${count("annual") + count("other_leave")} on leave`}
        action={
          <div className="flex items-center gap-1">
            <Link className={buttonClass("secondary", "sm")} href={hrefFor(addMonths(first, -1))} aria-label="Previous month"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={hrefFor(addMonths(first, 1))} aria-label="Next month"><ChevronRight className="size-4" aria-hidden /></Link>
          </div>
        }
      />
      <div className="p-3 sm:p-5">
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-muted" aria-hidden>
          {WEEKDAYS.map((w) => <div key={w} className="pb-1">{w}</div>)}
        </div>
        <ol className="grid grid-cols-7 gap-1" aria-label={`Attendance for ${monthLabel}`}>
          {Array.from({ length: lead }, (_, i) => <li key={`pad-${i}`} aria-hidden />)}
          {days.map((d) => (
            <li key={d.date} title={d.detail} className={cn("flex aspect-square min-h-11 flex-col items-center justify-center rounded-md p-0.5 text-center sm:aspect-auto sm:h-16", DAY_STYLE[d.kind].className)}>
              <span className="text-sm font-semibold leading-none">{Number(d.date.slice(8))}</span>
              {d.mins ? <span className="mt-1 hidden text-[0.6875rem] leading-none opacity-90 sm:block">{hm(d.mins)}</span> : null}
              <span className="sr-only">{d.detail}</span>
            </li>
          ))}
        </ol>
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Colour legend">
          {LEGEND.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={cn("inline-block size-3.5 rounded-sm", DAY_STYLE[k].className)} aria-hidden />
              {DAY_STYLE[k].label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">A day counts as worked if the person clocked in or logged timesheet hours. Weekdays without attendance, leave or a public holiday show as not working.</p>
      </div>
    </Panel>
  );
}
