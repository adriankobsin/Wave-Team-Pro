import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub, hubPendingTimesheets, hubTimesheets, type HubTimesheetRow } from "@/server/services/hub";
import { ReviewForm } from "@/components/ui/review-form";
import { reviewTimesheet } from "@/server/actions/workforce";
import { PanelHeader } from "@/components/ui/misc";
import { PersonLabel } from "@/components/ui/avatar";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { addDays, isDateString, todayIn, weekStart } from "@/lib/time";

export const metadata: Metadata = { title: "Timesheets" };

const STATUS: Record<HubTimesheetRow["status"], { label: string; tone: "ok" | "danger" | "warn" | "neutral" }> = {
  none: { label: "Not started", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "To approve", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Returned", tone: "danger" },
};
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const longDay = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default async function HubTimesheetsPage({ searchParams }: { searchParams: Promise<{ week?: string; company?: string; status?: string; q?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const week = weekStart(isDateString(sp.week) ? sp.week : todayIn(profile.timezone));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const company = hub.companies.some((c) => c.id === sp.company) ? sp.company! : "";
  const status = sp.status && sp.status in STATUS ? (sp.status as HubTimesheetRow["status"]) : "";
  const text = (sp.q ?? "").trim().toLowerCase();
  const [all, pendingAll] = await Promise.all([hubTimesheets(hub.companies, week), hubPendingTimesheets(hub.companies)]);
  const pending = pendingAll.filter((p) => (!company || p.company.id === company) && (!text || p.name.toLowerCase().includes(text)));
  const matched = all.filter((r) => (!company || r.company.id === company) && (!status || r.status === status) && (!text || r.name.toLowerCase().includes(text)));
  // Someone in five companies with time in one shouldn't fill five rows: empty, unstarted rows
  // are dropped when the person has another row (unless you filter to one company or status).
  const hasTime = new Set(matched.filter((r) => r.hours > 0 || r.status !== "none").map((r) => r.userId));
  const seen = new Set<string>();
  const rows = company || status ? matched : matched.filter((r) => {
    if (r.hours > 0 || r.status !== "none") return true;
    if (hasTime.has(r.userId) || seen.has(r.userId)) return false;
    seen.add(r.userId);
    return true;
  });
  const total = Math.round(rows.reduce((n, r) => n + r.hours, 0) * 100) / 100;
  const link = (extra: Record<string, string>) => `?${new URLSearchParams({ week, ...(company ? { company } : {}), ...(status ? { status } : {}), ...(sp.q ? { q: sp.q } : {}), ...extra })}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Timesheets"
        description={`Everyone's week in every company — ${longDay(week)} to ${longDay(addDays(week, 6))}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <a className={buttonClass("secondary")} href={`/hub/timesheets/export?week=${week}&format=xlsx`}><Download className="size-4" aria-hidden /> Excel</a>
            <a className={buttonClass("secondary")} href={`/hub/timesheets/export?week=${week}&format=pdf`}><Download className="size-4" aria-hidden /> PDF</a>
          </div>
        }
      />
      <Panel id="waiting" className={pending.length ? "border-brass/60" : undefined}>
        <PanelHeader
          title={`Waiting for approval (${pending.length})`}
          description="Every submitted timesheet, whatever the week or company. Approve it here or return it with a note."
        />
        {pending.length ? (
          <ul className="divide-y divide-line">
            {pending.map((s) => (
              <li key={s.id} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.userId ? <Link href={`/o/${s.company.slug}/timesheets/week?person=${s.userId}&week=${s.weekStart}`} className="hover:underline">{s.name}</Link> : s.name}</p>
                    <p className="text-xs text-ink-muted">{s.company.name}</p>
                  </div>
                  <span className="text-sm">Week {longDay(s.weekStart)} – {longDay(addDays(s.weekStart, 6))} · <strong className="tabular">{s.hours.toFixed(2)} h</strong></span>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-ink-muted">{s.entries.length} entries</summary>
                  <table className="mt-2 w-full">
                    <tbody className="divide-y divide-line">
                      {s.entries.map((e, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap py-1 pr-2">{dayLabel(e.workDate)}</td>
                          <td className="py-1 pr-2">{e.project ?? "—"}</td>
                          <td className="py-1 pr-2 text-ink-muted">{[e.category, e.description].filter(Boolean).join(" — ")}</td>
                          <td className="tabular py-1 text-right">{e.hours.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <ReviewForm action={reviewTimesheet} id={s.id} rejectNeedsNote rejectLabel="Return for changes" />
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-4 text-sm text-ink-muted sm:px-5">Nothing waiting — every submitted timesheet has been reviewed.</p>}
      </Panel>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link className={buttonClass("secondary", "sm")} href={link({ week: addDays(week, -7) })} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Link>
          <Link className={buttonClass("secondary", "sm")} href={link({ week: weekStart(todayIn(profile.timezone)) })}>This week</Link>
          <Link className={buttonClass("secondary", "sm")} href={link({ week: addDays(week, 7) })} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Link>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={week} />
          <label className="text-sm">Search
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Name" className="mt-1 block h-9 w-40 rounded-md border border-line bg-panel px-2" />
          </label>
          <label className="text-sm">Company
            <select name="company" defaultValue={company} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
              <option value="">All companies</option>
              {hub.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Status
            <select name="status" defaultValue={status} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
              <option value="">Any</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label} ({k === "submitted" ? pendingAll.length : all.filter((r) => r.status === k).length})</option>)}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>Show</button>
        </form>
      </div>

      {status === "submitted" ? null : <Panel className="overflow-x-auto">
        {rows.length ? (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Company</th>
                {days.map((d) => <th key={d} className="px-2 py-2 text-right font-medium">{dayLabel(d)}</th>)}
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.company.id}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/o/${r.company.slug}/timesheets/week?person=${r.userId}&week=${week}`} className="hover:underline">
                      <PersonLabel id={r.userId} name={r.name} src={r.avatarUrl} sub={r.jobTitle ?? undefined} size="sm" />
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-ink-muted">{r.hours > 0 || r.status !== "none" || company ? r.company.name : (all.filter((x) => x.userId === r.userId).length > 1 ? `${all.filter((x) => x.userId === r.userId).length} companies` : r.company.name)}</td>
                  {r.perDay.map((h, i) => <td key={i} className="tabular px-2 py-2 text-right">{h ? h.toFixed(2) : <span className="text-ink-muted">–</span>}</td>)}
                  <td className="tabular px-2 py-2 text-right font-semibold">{r.hours.toFixed(2)}</td>
                  <td className="px-4 py-2">
                    {r.status === "submitted"
                      ? <Link href={`/o/${r.company.slug}/approvals`}><Badge tone="warn">To approve</Badge></Link>
                      : <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-2" colSpan={2}>Total · {rows.length} timesheets</td>
                {days.map((_, i) => <td key={i} className="tabular px-2 py-2 text-right">{(Math.round(rows.reduce((n, r) => n + r.perDay[i], 0) * 100) / 100).toFixed(2)}</td>)}
                <td className="tabular px-2 py-2 text-right">{total.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        ) : <EmptyState title="No timesheets match" />}
      </Panel>}
      <p className="text-xs text-ink-muted">Click a name for that person&apos;s full week across companies, with clock-ins and downloads.</p>
    </div>
  );
}
