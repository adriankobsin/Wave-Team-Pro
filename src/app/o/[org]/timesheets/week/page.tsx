import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { buildPersonWeek, approvalLine, type CompanyWeek } from "@/server/services/person-week";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { addDays, isDateString, timeOf, todayIn, weekStart } from "@/lib/time";

export const metadata: Metadata = { title: "Week across companies" };

const TONE = { none: "neutral", draft: "neutral", submitted: "warn", approved: "ok", rejected: "danger" } as const;
const COLORS = ["#2f5d8a", "#c26a1a", "#2f7d5b", "#7a4fa3", "#a33b55", "#3b7f8f"];

function hourOf(iso: string, tz: string) {
  const [h, m] = timeOf(iso, tz).split(":").map(Number);
  return h + m / 60;
}

export default async function WeekAcrossCompanies({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ week?: string; person?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const week = weekStart(isDateString(sp.week) ? sp.week : todayIn(ctx.profile.timezone));

  const [{ data: visible }, people] = await Promise.all([supabase.rpc("time_people", { p_org: ctx.org.id }), listPeople(ctx.org.id)]);
  const ids = new Set(((visible ?? []) as { membership_id: string }[]).map((v) => v.membership_id));
  const staff = people.filter((p) => ids.has(p.membershipId) || p.membershipId === ctx.membership.id)
    .sort((a, b) => (a.userId === ctx.userId ? -1 : b.userId === ctx.userId ? 1 : a.name.localeCompare(b.name)));
  const person = sp.person && staff.some((p) => p.userId === sp.person) ? sp.person : ctx.userId;
  const w = await buildPersonWeek(supabase, person, week);
  if (!w) return <AccessDenied message="You can't see this person's time." hint="Choose someone you manage." />;

  const base = `/o/${ctx.org.slug}/timesheets/week`;
  const q = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(person !== ctx.userId ? { person } : {}), week, ...extra })}`;
  const exp = (scope: string, format: string) => `/o/${ctx.org.slug}/timesheets/export${q({ scope, format })}`;
  const color = new Map(w.companies.map((c, i) => [c.orgId, COLORS[i % COLORS.length]]));
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  const all = w.companies.flatMap((c) => c.sessions.map((s) => ({ ...s, c })));
  const from = Math.max(0, Math.min(7, ...all.map((s) => Math.floor(hourOf(s.start, s.tz)))));
  const to = Math.min(24, Math.max(18, ...all.map((s) => Math.ceil(s.end ? hourOf(s.end, s.tz) || 24 : 24))));
  const span = Math.max(1, to - from);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${w.name} — all companies`}
        description={`Week of ${fmtDay(week)} – ${fmtDay(addDays(week, 6))} · clock times in each project's local time`}
        actions={
          <div className="flex items-center gap-2">
            <Link className={buttonClass("secondary", "sm")} href={`${base}${q({ week: addDays(week, -7) })}`} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}${q({ week: weekStart(todayIn(ctx.profile.timezone)) })}`}>This week</Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}${q({ week: addDays(week, 7) })}`} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        {staff.length > 1 ? (
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="week" value={week} />
            <label className="text-sm">Person
              <select name="person" defaultValue={person} className="mt-1 block h-9 min-w-56 rounded-md border border-line bg-panel px-2">
                {staff.map((p) => <option key={p.userId} value={p.userId}>{p.userId === ctx.userId ? `${p.name} (me)` : p.name}</option>)}
              </select>
            </label>
            <button type="submit" className={buttonClass("secondary")}>Show</button>
          </form>
        ) : <span />}
        <div className="flex flex-wrap gap-2">
          <a className={buttonClass("secondary", "sm")} href={exp("all", "pdf")}><Download className="size-4" aria-hidden /> PDF</a>
          <a className={buttonClass("secondary", "sm")} href={exp("all", "xlsx")}><Download className="size-4" aria-hidden /> Excel</a>
          <Link className={buttonClass("ghost", "sm")} href={`/o/${ctx.org.slug}/timesheets?week=${week}`}>{ctx.org.name} only</Link>
        </div>
      </div>

      {!w.companies.length ? <Panel><EmptyState title="Nothing to show">You can only see companies where you manage this person.</EmptyState></Panel> : (
        <>
          <Panel>
            <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
              <div className="p-4"><p className="text-xs uppercase tracking-wide text-ink-muted">Clocked</p><p className="tabular text-2xl font-semibold">{w.clocked.toFixed(2)} h</p></div>
              <div className="p-4"><p className="text-xs uppercase tracking-wide text-ink-muted">On timesheets</p><p className="tabular text-2xl font-semibold">{w.logged.toFixed(2)} h</p></div>
              {w.companies.slice(0, 2).map((c) => (
                <div key={c.orgId} className="p-4"><p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-muted"><span className="size-2.5 rounded-sm" style={{ background: color.get(c.orgId) }} />{c.name}</p><p className="tabular text-2xl font-semibold">{c.total.toFixed(2)} h</p></div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Where they were, day by day" description="From clock-ins and project switches." />
            <div className="overflow-x-auto px-4 pb-4 sm:px-5">
              <div className="grid min-w-[640px] grid-cols-[88px_1fr_56px] items-center gap-x-3 gap-y-2">
                {w.days.map((d) => {
                  const day = all.filter((s) => s.day === d);
                  const hours = day.reduce((n, s) => n + s.hours, 0);
                  return (
                    <div key={d} className="contents">
                      <div className="text-sm">{fmtDay(d)}</div>
                      <div className="relative h-7 rounded bg-panel-sunk">
                        {day.map((s, i) => {
                          const a = hourOf(s.start, s.tz);
                          const b = s.end ? hourOf(s.end, s.tz) || 24 : Math.min(24, a + s.hours + s.breakMinutes / 60);
                          return (
                            <div key={i} title={`${s.c.name} · ${s.project} · ${timeOf(s.start, s.tz)}–${s.end ? timeOf(s.end, s.tz) : "now"}`}
                              className="absolute inset-y-1 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 text-[11px] leading-5 text-white"
                              style={{ left: `${((a - from) / span) * 100}%`, width: `${(Math.max(0.25, b - a) / span) * 100}%`, background: color.get(s.c.orgId) }}>
                              {s.project}
                            </div>
                          );
                        })}
                      </div>
                      <div className="tabular text-right text-sm">{hours ? hours.toFixed(2) : "–"}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
                {w.companies.map((c) => <span key={c.orgId} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: color.get(c.orgId) }} />{c.name} · {c.clocked.toFixed(2)} h clocked</span>)}
                <span>Scale {String(from).padStart(2, "0")}:00–{String(to).padStart(2, "0")}:00</span>
              </div>
            </div>
          </Panel>

          {w.companies.map((c) => <CompanyTable key={c.orgId} c={c} days={w.days} tz={w.tz} color={color.get(c.orgId)!} fmtDay={fmtDay} />)}
        </>
      )}
    </div>
  );
}

function CompanyTable({ c, days, tz, color, fmtDay }: { c: CompanyWeek; days: string[]; tz: string; color: string; fmtDay: (d: string) => string }) {
  return (
    <Panel className="overflow-x-auto">
      <PanelHeader
        title={c.name}
        description={approvalLine(c, tz)}
        action={<span className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: color }} /><Badge tone={TONE[c.status]}>{c.status === "none" ? "Not started" : c.status}</Badge></span>}
      />
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-muted">
            <th className="px-4 py-2 font-medium">Project</th>
            {days.map((d) => <th key={d} className="px-2 py-2 text-right font-medium">{fmtDay(d).split(" ")[0]}</th>)}
            <th className="px-4 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {c.rows.map((r) => (
            <tr key={r.label}>
              <td className="px-4 py-2">{r.label}</td>
              {r.perDay.map((h, i) => <td key={i} className={`tabular px-2 py-2 text-right ${h ? "" : "text-ink-muted/50"}`}>{h ? h.toFixed(2) : "–"}</td>)}
              <td className="tabular px-4 py-2 text-right">{r.total.toFixed(2)}</td>
            </tr>
          ))}
          {!c.rows.length ? <tr><td colSpan={9} className="px-4 py-3 text-ink-muted">No time on this timesheet yet.</td></tr> : (
            <tr className="font-semibold">
              <td className="px-4 py-2">Total</td>
              {c.perDay.map((h, i) => <td key={i} className="tabular px-2 py-2 text-right">{h.toFixed(2)}</td>)}
              <td className="tabular px-4 py-2 text-right">{c.total.toFixed(2)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}
