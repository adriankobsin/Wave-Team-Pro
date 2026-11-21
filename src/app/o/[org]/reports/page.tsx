import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { buildReport, monthRange } from "@/server/services/reports";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatMoney } from "@/lib/format";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

const isMonth = (s?: string) => Boolean(s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s));

function Bars({ rows, unit, empty }: { rows: { label: string; value: number; note?: string }[]; unit: string; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-ink-muted sm:px-5">{empty}</p>;
  return (
    <ul className="space-y-2.5 p-4 sm:p-5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded-sm bg-panel-sunk" aria-hidden>
            <span className="block h-full rounded-sm bg-hull dark:bg-brass" style={{ width: `${max ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
          </span>
          <span className="tabular text-right">{r.value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} {unit}{r.note ? <span className="block text-xs text-ink-muted">{r.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

function MoneyTable({ rows, empty }: { rows: { label: string; currency: string; total: number; count: number }[]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-ink-muted sm:px-5">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={`${r.label}-${r.currency}`}>
            <td className="px-4 py-2 sm:px-5">{r.label}</td>
            <td className="px-2 py-2 text-right text-ink-muted">{r.count}</td>
            <td className="tabular px-4 py-2 text-right font-medium sm:px-5">{formatMoney(r.total, r.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.hasAnyScope("reports.view")) return <AccessDenied message="Reports aren't enabled for your role." hint="Ask an administrator." />;
  const thisMonth = todayIn(ctx.profile.timezone).slice(0, 7);
  const from = isMonth(sp.from) ? sp.from! : thisMonth;
  const to = isMonth(sp.to) ? sp.to! : from;
  const report = await buildReport(ctx.org.id, monthRange(from, to));
  const { hours, expenses, leave } = report;
  const q = new URLSearchParams({ from, to }).toString();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Approved hours, expenses and leave from ${report.range.from} to ${report.range.to}. Figures include only records your role can see.`}
        actions={ctx.perms.has("reports.export") ? <a href={`/o/${ctx.org.slug}/reports/export?${q}`} className={buttonClass("secondary")}>Download Excel</a> : null}
      />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">From<input type="month" name="from" defaultValue={from} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2" /></label>
        <label className="text-sm">To<input type="month" name="to" defaultValue={to} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2" /></label>
        <button type="submit" className={buttonClass("secondary")}>Show</button>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Approved hours</p><p className="tabular mt-1 text-2xl font-semibold">{hours.total.toLocaleString("en-GB")}</p>{hours.overtime ? <p className="text-xs text-ink-muted">{hours.overtime} h overtime</p> : null}</div></Panel>
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Approved expenses</p><p className="tabular mt-1 text-2xl font-semibold">{expenses.byCurrency.length ? expenses.byCurrency.map((c) => formatMoney(c.total, c.currency)).join(" + ") : "—"}</p><p className="text-xs text-ink-muted">{expenses.count} claims</p></div></Panel>
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Converted to {expenses.reporting.currency ?? ctx.org.base_currency}</p><p className="tabular mt-1 text-2xl font-semibold">{expenses.reporting.count ? formatMoney(expenses.reporting.total, expenses.reporting.currency ?? ctx.org.base_currency) : "—"}</p>{expenses.reporting.unconverted ? <p className="text-xs text-ink-muted">{expenses.reporting.unconverted} without an exchange rate (excluded)</p> : null}</div></Panel>
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Reimbursements due</p><p className="tabular mt-1 text-2xl font-semibold">{expenses.reimbursementDue.length ? expenses.reimbursementDue.map((c) => formatMoney(c.total, c.currency)).join(" + ") : "—"}</p></div></Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel><PanelHeader title="Hours by project" /><Bars unit="h" empty="No approved timesheets in this period." rows={hours.byProject.map((l) => ({ label: l.label, value: l.hours, note: l.overtime ? `${l.overtime} h overtime` : undefined }))} /></Panel>
        <Panel><PanelHeader title="Hours by person" /><Bars unit="h" empty="No approved timesheets in this period." rows={hours.byPerson.map((l) => ({ label: l.label, value: l.hours, note: l.overtime ? `${l.overtime} h overtime` : undefined }))} /></Panel>
        <Panel><PanelHeader title="Expenses by category" description="Per currency; currencies are never added together." /><MoneyTable rows={expenses.byCategory} empty="No approved expenses in this period." /></Panel>
        <Panel><PanelHeader title="Expenses by person" /><MoneyTable rows={expenses.byPerson} empty="No approved expenses in this period." /></Panel>
        <Panel><PanelHeader title="Expenses by project" /><MoneyTable rows={expenses.byProject} empty="No approved expenses in this period." /></Panel>
        <Panel><PanelHeader title="Leave taken (working days)" /><Bars unit="d" empty="No approved leave in this period." rows={[...leave.byType.map((l) => ({ label: l.label, value: l.days })), ...(leave.byPerson.length ? [] : [])]} />
          {leave.byPerson.length ? <details className="border-t border-line px-4 py-3 text-sm sm:px-5"><summary className="cursor-pointer">By person</summary><ul className="mt-2 space-y-1">{leave.byPerson.map((l) => <li key={l.label} className="flex justify-between"><span>{l.label}</span><span className="tabular">{l.days} d</span></li>)}</ul></details> : null}
        </Panel>
      </div>
    </div>
  );
}
