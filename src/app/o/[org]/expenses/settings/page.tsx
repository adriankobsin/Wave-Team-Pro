import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { addExchangeRate, deleteExchangeRate, saveCategory } from "@/server/actions/expenses";
import { fetchEcbRates, loadTaxPack, saveAccountingSettings, saveTaxRate } from "@/server/actions/bookkeeping";
import { CountrySelect, CurrencySelect } from "@/components/ui/region-select";
import { countryName } from "@/lib/regions";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Badge, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Expense settings" };

export default async function ExpenseSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const canCategories = ctx.perms.has("org.settings.manage") || ctx.perms.has("expenses.export");
  const canRates = ctx.perms.has("expenses.export") || ctx.perms.has("reimbursements.manage");
  if (!canCategories && !canRates) return <AccessDenied message="Only bookkeepers and administrators manage expense settings." hint="Ask an administrator." />;
  const supabase = await createClient();
  const canAccounting = ctx.perms.has("expenses.export") || ctx.perms.has("org.settings.manage");
  const [{ data: taxRates }, { data: acct }] = await Promise.all([
    supabase.from("tax_rates").select("*").eq("organization_id", ctx.org.id).order("position").order("name"),
    supabase.from("accounting_settings").select("*").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  const [{ data: categories }, { data: rates }] = await Promise.all([
    supabase.from("expense_categories").select("*").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("exchange_rates").select("*").eq("organization_id", ctx.org.id).order("rate_date", { ascending: false }).limit(100),
  ]);

  return (
    <div className="space-y-6">
      <Link href={`/o/${ctx.org.slug}/expenses?view=all`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Expenses</Link>
      <PageHeader title="VAT, accounts & exchange rates" description={`Reports are in ${ctx.org.base_currency}. Foreign-currency expenses are converted only with a rate entered here.`} />

      {canAccounting ? (
        <Panel>
          <PanelHeader title="VAT rates" description="“Name in Xero” must match the tax rate name in Xero exactly (Accounting → Advanced → Tax rates). Non-reclaimable rates are excluded from reclaimable VAT." />
          <ul className="divide-y divide-line">
            {(taxRates ?? []).map((t) => (
              <li key={t.id} className="px-4 py-3 sm:px-5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-sm text-ink-muted">{Number(t.rate)}% · Xero: {t.accounting_name}</span>
                    {!t.reclaimable ? <Badge>Not reclaimable</Badge> : null}
                    {!t.active ? <Badge tone="danger">Hidden</Badge> : null}
                  </summary>
                  <ActionForm action={saveTaxRate} className="mt-3 grid gap-3 sm:grid-cols-3">
                    <input type="hidden" name="organization_id" value={ctx.org.id} />
                    <input type="hidden" name="id" value={t.id} />
                    <TextField label="Name" name="name" defaultValue={t.name} maxLength={60} />
                    <TextField label="Rate %" name="rate" type="number" step="0.01" min={0} max={100} defaultValue={Number(t.rate)} />
                    <TextField label="Name in Xero" name="accounting_name" defaultValue={t.accounting_name} maxLength={80} />
                    <CheckboxField name="reclaimable" defaultChecked={t.reclaimable} label="VAT is reclaimable" />
                    <CheckboxField name="active" defaultChecked={t.active} label="Available" />
                    <div><SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save</SubmitButton></div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
          <ActionForm action={loadTaxPack} className="flex flex-wrap items-end gap-3 border-t border-line p-4 sm:p-5">
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <div className="min-w-56"><CountrySelect label="Add the standard rates for" name="country" defaultValue={ctx.org.country} hint={`This company is in ${countryName(ctx.org.country)}`} /></div>
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add country rates</SubmitButton>
          </ActionForm>
          <ActionForm action={saveTaxRate} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_6rem_1fr_auto_auto] sm:items-end sm:p-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <TextField label="New VAT rate" name="name" required maxLength={60} />
            <TextField label="Rate %" name="rate" type="number" step="0.01" min={0} max={100} required />
            <TextField label="Name in Xero" name="accounting_name" required maxLength={80} />
            <div className="pb-2"><CheckboxField name="reclaimable" defaultChecked label="Reclaimable" /></div>
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      {canAccounting ? (
        <Panel>
          <PanelHeader title="Xero export settings" />
          <ActionForm action={saveAccountingSettings} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <TextField label="Bill number prefix" name="bill_prefix" defaultValue={acct?.bill_prefix ?? "EXP"} maxLength={12} hint="Bills are numbered PREFIX-date-001" />
            <TextField label="Bill due after (days)" name="bill_due_days" type="number" min={0} max={90} defaultValue={acct?.bill_due_days ?? 0} />
            <TextField label="Fallback account code" name="default_account_code" optional defaultValue={acct?.default_account_code ?? ""} maxLength={32} hint="Used when a category has no code" />
            <TextField label="Tracking category for projects" name="tracking_name" optional defaultValue={acct?.tracking_name ?? ""} maxLength={40} hint="Exact Xero tracking category name, e.g. Project" />
            <div className="sm:col-span-2 lg:col-span-4"><SubmitButton variant="secondary" pendingLabel="Saving…">Save settings</SubmitButton></div>
          </ActionForm>
        </Panel>
      ) : null}

      {canCategories ? (
        <Panel>
          <PanelHeader title="Expense categories → Xero accounts" description="The account code is the Xero account each category posts to (e.g. 400 Advertising, 493 Travel – National). Categories don’t decide tax treatment." />
          <ul className="divide-y divide-line">
            {(categories ?? []).map((c) => (
              <li key={c.id} className="px-4 py-3 sm:px-5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.accounting_code ? <span className="text-sm text-ink-muted">{c.accounting_code}</span> : null}
                    {!c.receipt_required ? <Badge>Receipt optional</Badge> : null}
                    {!c.active ? <Badge tone="danger">Hidden</Badge> : null}
                  </summary>
                  <ActionForm action={saveCategory} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="organization_id" value={ctx.org.id} />
                    <input type="hidden" name="id" value={c.id} />
                    <TextField label="Name" name="name" defaultValue={c.name} maxLength={60} />
                    <TextField label="Account code" name="accounting_code" optional defaultValue={c.accounting_code ?? ""} maxLength={32} />
                    <CheckboxField name="receipt_required" defaultChecked={c.receipt_required} label="Receipt required" />
                    <CheckboxField name="active" defaultChecked={c.active} label="Available for new expenses" />
                    <div><SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save</SubmitButton></div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
          <ActionForm action={saveCategory} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-end sm:p-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <TextField label="New category" name="name" required maxLength={60} />
            <TextField label="Account code" name="accounting_code" optional maxLength={32} />
            <div className="pb-2"><CheckboxField name="receipt_required" defaultChecked label="Receipt required" /></div>
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      {canRates ? (
        <Panel>
          <PanelHeader title="Exchange rates" description="The latest rate on or before the receipt date is used when an expense is submitted or approved. Record where each rate came from." />
          <ActionForm action={fetchEcbRates} className="flex flex-wrap items-end gap-3 border-b border-line px-4 pb-4 sm:px-5">
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <label className="text-sm">Month<input type="month" name="month" required defaultValue={todayIn(ctx.profile.timezone).slice(0, 7)} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2" /></label>
            <SubmitButton variant="secondary" pendingLabel="Fetching…">Fetch ECB rates for claims in this month</SubmitButton>
            <p className="w-full text-xs text-ink-muted">Uses the European Central Bank’s daily reference rates for every foreign currency your claims use (EUR, USD, SGD, THB and more). The Cambodian riel isn’t published by the ECB; add KHR rates by hand.</p>
          </ActionForm>
          {(rates ?? []).length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-ink-muted"><tr><th className="px-4 py-2 font-normal sm:px-5">Date</th><th className="px-2 py-2 font-normal">Pair</th><th className="px-2 py-2 text-right font-normal">Rate</th><th className="px-2 py-2 font-normal">Source</th><th /></tr></thead>
                <tbody className="divide-y divide-line">
                  {(rates ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 sm:px-5">{r.rate_date}</td>
                      <td className="px-2 py-2">{r.from_currency} → {r.to_currency}</td>
                      <td className="tabular px-2 py-2 text-right">{Number(r.rate)}</td>
                      <td className="px-2 py-2 text-ink-muted">{r.source}</td>
                      <td className="px-4 py-2 text-right">
                        <InlineActionForm action={deleteExchangeRate} confirm="Delete this rate? Already-approved expenses keep the rate they used.">
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="text-xs text-ink-muted underline">Delete</button>
                        </InlineActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-4 pb-2 text-sm text-ink-muted sm:px-5">No rates yet. Expenses in {ctx.org.base_currency} don’t need one.</p>}
          <ActionForm action={addExchangeRate} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3 lg:grid-cols-6 sm:items-end sm:p-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <input type="hidden" name="to_currency" value={ctx.org.base_currency} />
            <CurrencySelect label="From currency" name="from_currency" required defaultValue={ctx.org.base_currency === "EUR" ? "GBP" : "EUR"} />
            <TextField label={`Rate to ${ctx.org.base_currency}`} name="rate" type="number" step="0.000001" min={0} required />
            <TextField label="Rate date" name="rate_date" type="date" required defaultValue={todayIn(ctx.profile.timezone)} />
            <div className="lg:col-span-2"><TextField label="Source" name="source" required maxLength={120} placeholder="e.g. Bank of England daily spot" /></div>
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add rate</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
