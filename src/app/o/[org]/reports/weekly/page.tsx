import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { buildWeekly } from "@/server/services/weekly";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { addDays, isDateString, todayIn, weekStart } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Weekly timesheets" };

const TONE = { none: "danger", draft: "neutral", submitted: "warn", approved: "ok", rejected: "danger" } as const;
const LABEL = { none: "Not started", draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Returned" } as const;

export default async function WeeklyPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ week?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const p = ctx.perms;
  if (!(p.has("attendance.view.all") || p.hasAnyScope("attendance.view.team") || p.hasAnyScope("timesheets.approve") || p.hasAnyScope("reports.view"))) {
    return <AccessDenied message="The weekly timesheet is for managers, HR and directors." hint="Ask an administrator." />;
  }
  const tz = ctx.profile.timezone;
  const wk = weekStart(isDateString(sp.week) ? sp.week : addDays(todayIn(tz), -7));
  const supabase = await createClient();
  const { days, rows } = await buildWeekly(supabase, ctx.org.id, wk, ctx.org.timezone);
  const base = `/o/${ctx.org.slug}/reports/weekly`;
  const fmt = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const total = (i: number) => Math.round(rows.reduce((n, r) => n + r.logged[i], 0) * 100) / 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly timesheets"
        description={`All staff you can see, week of ${fmt(wk)} ${wk.slice(0, 7)}. Timesheet hours with clocked hours underneath; leave is shown by type.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(wk, -7)}`} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(wk, 7)}`} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Link>
            <a className={buttonClass("secondary", "sm")} href={`${base}/export?week=${wk}&format=pdf`}>Download PDF</a>
            <a className={buttonClass("secondary", "sm")} href={`${base}/export?week=${wk}`}>Download Excel</a>
          </div>
        }
      />
      {rows.length ? (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-2 py-2 font-medium">Timesheet</th>
                {days.map((d) => <th key={d} className="px-2 py-2 text-right font-medium">{fmt(d)}</th>)}
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.membershipId}>
                  <td className="px-4 py-2">
                    <Link href={`/o/${ctx.org.slug}/timesheets?person=${r.membershipId}&week=${wk}#calendar`} className="font-medium underline-offset-4 hover:underline">{r.name}</Link>
                    {r.jobTitle ? <span className="block text-xs text-ink-muted">{r.jobTitle}</span> : null}
                  </td>
                  <td className="px-2 py-2"><Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge></td>
                  {days.map((d, i) => (
                    <td key={d} className={cn("tabular px-2 py-2 text-right", r.leave[i] && "bg-[#2e6fb7]/10")}>
                      {r.logged[i] ? r.logged[i].toFixed(2) : r.leave[i] ? <span className="text-xs">{r.leave[i]}</span> : <span className="text-ink-muted">—</span>}
                      {r.clocked[i] ? <span className="block text-[0.6875rem] text-ink-muted">{r.clocked[i].toFixed(2)} clk</span> : null}
                    </td>
                  ))}
                  <td className="tabular px-4 py-2 text-right font-semibold">{r.totalLogged.toFixed(2)}{r.overtime ? <span className="block text-[0.6875rem] font-normal text-ink-muted">{r.overtime} OT</span> : null}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-2" colSpan={2}>Total</td>
                {days.map((d, i) => <td key={d} className="tabular px-2 py-2 text-right">{total(i).toFixed(2)}</td>)}
                <td className="tabular px-4 py-2 text-right">{rows.reduce((n, r) => n + r.totalLogged, 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </Panel>
      ) : <EmptyState title="Nobody to show">You can only see people whose time you manage.</EmptyState>}
    </div>
  );
}
