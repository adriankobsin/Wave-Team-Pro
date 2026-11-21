import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub, hubExpenses } from "@/server/services/hub";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Expenses" };

const STATUS: Record<string, { label: string; tone: "ok" | "danger" | "warn" | "neutral" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "To approve", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Returned", tone: "danger" },
};
const money = (n: number | null, cur: string | null) => {
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur ?? "GBP" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur ?? ""}`;
  }
};

export default async function HubExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; company?: string; status?: string; q?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const month = sp.month === "" ? "" : sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayIn(profile.timezone).slice(0, 7);
  const status = sp.status && (sp.status in STATUS) ? sp.status : "";
  const company = hub.companies.some((c) => c.id === sp.company) ? sp.company! : "";
  const text = (sp.q ?? "").trim().toLowerCase();
  const all = await hubExpenses(company ? hub.companies.filter((c) => c.id === company) : hub.companies, { month, status });
  const rows = all.filter((r) => !text || `${r.name} ${r.merchant ?? ""} ${r.description ?? ""}`.toLowerCase().includes(text));
  const byCompany = hub.companies.map((c) => {
    const list = rows.filter((r) => r.company.id === c.id);
    return { c, count: list.length, total: Math.round(list.reduce((n, r) => n + (r.reportingTotal ?? 0), 0) * 100) / 100 };
  }).filter((x) => x.count);

  return (
    <div className="space-y-4">
      <PageHeader title="Expenses" description="Expense claims from every company. Totals are in each company's own currency." />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Person, merchant" className="mt-1 block h-9 w-44 rounded-md border border-line bg-panel px-2" />
        </label>
        <label className="text-sm">Month
          <input type="month" name="month" defaultValue={month} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2" />
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
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <button type="submit" className={buttonClass("secondary")}>Show</button>
        {month ? <Link className="h-9 px-2 text-sm leading-9 underline" href={`?${new URLSearchParams({ month: "", ...(company ? { company } : {}), ...(status ? { status } : {}) })}`}>All months</Link> : null}
      </form>

      {byCompany.length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {byCompany.map(({ c, count, total }) => (
            <div key={c.id} className="rounded-lg border border-line bg-panel p-3">
              <p className="truncate text-xs text-ink-muted">{c.name}</p>
              <p className="tabular text-lg font-semibold">{money(total, c.currency)}</p>
              <p className="text-xs text-ink-muted">{count} claims</p>
            </div>
          ))}
        </div>
      ) : null}

      <Panel className="overflow-x-auto">
        {rows.length ? (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Company</th>
                <th className="px-2 py-2 font-medium">Merchant / description</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 text-right font-medium">Company currency</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="tabular px-4 py-2 text-ink-muted">{r.date ?? "—"}</td>
                  <td className="px-2 py-2">{r.name}</td>
                  <td className="px-2 py-2 text-ink-muted">{r.company.name}</td>
                  <td className="px-2 py-2">
                    <Link href={`/o/${r.company.slug}/expenses/${r.id}`} className="hover:underline">{r.merchant || r.description || "Expense"}</Link>
                    {r.receipts ? <Paperclip className="ml-1 inline size-3 text-ink-muted" aria-label={`${r.receipts} receipt${r.receipts === 1 ? "" : "s"}`} /> : null}
                  </td>
                  <td className="tabular px-2 py-2 text-right">{money(r.total, r.currency)}</td>
                  <td className="tabular px-2 py-2 text-right text-ink-muted">{r.reportingTotal === null ? "—" : money(r.reportingTotal, r.company.currency)}</td>
                  <td className="px-4 py-2"><Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title="No expense claims match" />}
      </Panel>
      <p className="text-xs text-ink-muted">Click a claim to open it in its company, where you can approve it, see receipts or export to Xero.</p>
    </div>
  );
}
