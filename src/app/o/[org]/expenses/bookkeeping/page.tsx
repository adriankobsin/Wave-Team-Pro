import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { listExpenses, type ExpenseRow } from "@/server/services/expenses";
import { markReimbursed } from "@/server/actions/expenses";
import { setPeriod, undoExport } from "@/server/actions/bookkeeping";
import { totalsByCurrency } from "@/lib/export/cells";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { EXPENSE_STATUS } from "@/components/expenses/labels";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";
import { addDays, addMonths, todayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bookkeeping" };

const money = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([c, v]) => formatMoney(v, c)).join(" + ") : "—");

function Tile({ label, value, sub, href, tone }: { label: string; value: string | number; sub?: string; href?: string; tone?: "attention" | "ok" }) {
  const body = (
    <div className={cn("h-full rounded-lg border bg-panel p-4", tone === "attention" ? "border-brass/70" : "border-line")}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-muted">{sub}</p> : null}
    </div>
  );
  return href ? <a href={href} className="block hover:opacity-90">{body}</a> : body;
}

export default async function BookkeepingPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ month?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const p = ctx.perms;
  if (!p.has("expenses.export") && !p.has("reimbursements.manage") && !p.has("expenses.view.all")) {
    return <AccessDenied message="Bookkeeping is for finance roles." hint="Ask an administrator for the Bookkeeper role." />;
  }
  const tz = ctx.profile.timezone;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayIn(tz).slice(0, 7);
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const base = `/o/${ctx.org.slug}/expenses`;
  const supabase = await createClient();

  const [rows, people, { data: rates }, { data: categories }, { data: cards }, { data: period }, { data: exportsLog }, { data: cardLines }, { data: projects }] = await Promise.all([
    listExpenses(ctx.org.id, { from, to }),
    listPeople(ctx.org.id, { includeInactive: true }),
    supabase.from("tax_rates").select("id, name, reclaimable, accounting_name").eq("organization_id", ctx.org.id).order("position"),
    supabase.from("expense_categories").select("id, name, accounting_code").eq("organization_id", ctx.org.id),
    supabase.from("company_cards").select("id, name, last4, active").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("accounting_periods").select("closed_at, closed_by, reopened_at").eq("organization_id", ctx.org.id).eq("month", from).maybeSingle(),
    supabase.from("accounting_exports").select("id, kind, actor_id, row_count, filters, undone_at, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(8),
    supabase.from("card_transactions").select("card_id, status, amount, currency").eq("organization_id", ctx.org.id).gte("txn_date", from).lte("txn_date", to),
    supabase.from("projects").select("id, name").eq("organization_id", ctx.org.id),
  ]);
  const projName = new Map((projects ?? []).map((x) => [x.id, x.name]));
  // Unpaid reimbursements are listed regardless of month.
  const due = await listExpenses(ctx.org.id, { status: "approved", reimbursement: "pending" });
  const name = new Map(people.map((x) => [x.membershipId, x.name]));
  const userName = new Map(people.map((x) => [x.userId, x.name]));
  const code = new Map((categories ?? []).map((c) => [c.id, c.accounting_code as string | null]));
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const rate = new Map((rates ?? []).map((r) => [r.id, r]));
  const closed = Boolean(period && !period.reopened_at);

  const live = rows.filter((r) => r.status !== "cancelled");
  const submitted = live.filter((r) => r.status === "submitted");
  const approved = live.filter((r) => r.status === "approved");
  const drafts = live.filter((r) => r.status === "draft" || r.status === "rejected");
  const toExport = approved.filter((r) => !r.accounting_export_id);
  const tot = (list: ExpenseRow[]) => totalsByCurrency(list, (r) => r.currency, (r) => r.total);

  type Issue = { r: ExpenseRow; problems: string[] };
  const issues: Issue[] = [...submitted, ...approved]
    .map((r) => {
      const problems: string[] = [];
      if (!r.receipts.length) problems.push(r.no_receipt_reason ? `No receipt (“${r.no_receipt_reason}”)` : "No receipt");
      if (!r.tax_rate_id) problems.push("No VAT rate");
      if (r.category_id && !code.get(r.category_id)) problems.push("Category has no account code");
      if (r.currency && r.currency !== ctx.org.base_currency && r.reporting_total === null) problems.push(`No ${r.currency}→${ctx.org.base_currency} rate`);
      if (r.duplicate_override) problems.push("Possible duplicate (confirmed by submitter)");
      return { r, problems };
    })
    .filter((x) => x.problems.length);

  // VAT summary for approved claims, per rate and currency
  type VatRow = { rate: string; reclaimable: boolean; currency: string; gross: number; vat: number; count: number };
  const vatMap = new Map<string, VatRow>();
  for (const r of approved) {
    if (!r.currency || r.total === null) continue;
    const t = r.tax_rate_id ? rate.get(r.tax_rate_id) : null;
    const k = `${t?.name ?? "Not coded"}|${r.currency}`;
    const v = vatMap.get(k) ?? { rate: t?.name ?? "Not coded", reclaimable: Boolean(t?.reclaimable), currency: r.currency, gross: 0, vat: 0, count: 0 };
    v.gross = Math.round((v.gross + r.total) * 100) / 100;
    v.vat = Math.round((v.vat + (r.tax_amount ?? 0)) * 100) / 100;
    v.count++;
    vatMap.set(k, v);
  }
  const vatRows = [...vatMap.values()].sort((a, b) => a.rate.localeCompare(b.rate));
  const reclaimable = totalsByCurrency(vatRows.filter((v) => v.reclaimable), (v) => v.currency, (v) => v.vat);

  // Reimbursements due, grouped by person and currency
  const duePeople = new Map<string, ExpenseRow[]>();
  for (const r of due) duePeople.set(r.membership_id, [...(duePeople.get(r.membership_id) ?? []), r]);

  const unmatched = (cardLines ?? []).filter((l) => l.status === "unmatched");
  const byCard = (cards ?? []).map((c) => ({ ...c, unmatched: unmatched.filter((l) => l.card_id === c.id).length, total: (cardLines ?? []).filter((l) => l.card_id === c.id).length }));

  const group = (key: (r: ExpenseRow) => string) => {
    const m = new Map<string, ExpenseRow[]>();
    for (const r of approved) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));
  const q = (extra: Record<string, string>) => new URLSearchParams({ from, to, ...extra }).toString();
  const toExportBills = toExport.filter((r) => r.payment_method !== "company_card");
  const toExportCard = (id: string) => toExport.filter((r) => r.payment_method === "company_card" && r.card_id === id);
  const unassignedCard = toExport.filter((r) => r.payment_method === "company_card" && !r.card_id);

  return (
    <div className="space-y-6">
      <Link href={`${base}?view=all`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Expenses</Link>
      <PageHeader
        title={`Bookkeeping — ${monthLabel}`}
        description="Everything needed to close the month: approvals, receipts, VAT coding, card reconciliation, reimbursements and the Xero export."
        actions={
          <div className="flex items-center gap-2">
            <Link className={buttonClass("secondary", "sm")} href={`${base}/bookkeeping?month=${addMonths(from, -1).slice(0, 7)}`} aria-label="Previous month"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}/bookkeeping?month=${addMonths(from, 1).slice(0, 7)}`} aria-label="Next month"><ChevronRight className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}/cards`}>Company cards</Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}/settings`}>VAT & accounts</Link>
          </div>
        }
      />

      {closed ? <Notice tone="ok" title={`${monthLabel} is closed`}>Closed {formatDateTime(period!.closed_at, tz)} by {userName.get(period!.closed_by) ?? "a bookkeeper"}. Claims dated in this month can’t be submitted or changed.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Waiting for approval" value={submitted.length} sub={money(tot(submitted))} href={`${base}?view=all&month=${month}&status=submitted`} tone={submitted.length ? "attention" : undefined} />
        <Tile label="Approved, not yet in Xero" value={toExport.length} sub={money(tot(toExport))} tone={toExport.length ? "attention" : "ok"} />
        <Tile label="Need attention" value={issues.length} sub="missing receipt, VAT, account or FX rate" tone={issues.length ? "attention" : "ok"} />
        <Tile label="Unmatched card lines" value={unmatched.length} sub={money(totalsByCurrency(unmatched, (l) => l.currency, (l) => Number(l.amount)))} href={`${base}/cards`} tone={unmatched.length ? "attention" : "ok"} />
        <Tile label="Approved this month" value={approved.length} sub={money(tot(approved))} />
        <Tile label={`Reclaimable VAT`} value={money(reclaimable)} sub="from coded, approved claims" />
        <Tile label="Reimbursements due (all months)" value={due.length} sub={money(tot(due))} tone={due.length ? "attention" : undefined} />
        <Tile label="Drafts and returned" value={drafts.length} sub="not yet submitted by staff" />
      </div>

      <Panel>
        <PanelHeader title={`Needs attention (${issues.length})`} description="Fix these before exporting. Open a claim to code VAT, change the category or ask for a receipt." />
        {issues.length ? (
          <ul className="divide-y divide-line">
            {issues.slice(0, 60).map(({ r, problems }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <Link href={`${base}/${r.id}`} className="min-w-0">
                  <span className="font-medium underline-offset-4 hover:underline">{r.merchant ?? "Expense"}</span>
                  <span className="text-ink-muted"> · {r.expense_date} · {name.get(r.membership_id) ?? "Former colleague"} · {EXPENSE_STATUS[r.status]}</span>
                </Link>
                <span className="flex flex-wrap items-center gap-1.5">
                  {problems.map((x) => <Badge key={x} tone="warn">{x}</Badge>)}
                  <span className="tabular font-medium">{r.total !== null && r.currency ? formatMoney(r.total, r.currency) : "—"}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">Nothing outstanding for {monthLabel}.</p>}
      </Panel>

      {p.has("expenses.export") ? (
        <Panel>
          <PanelHeader title="Export to Xero" description={`Approved claims dated ${from} to ${to} that haven’t been exported yet. Downloading with “mark as exported” stops them being exported twice; you can undo it below.`} />
          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
              <div>
                <p className="font-medium">Employee claims → Xero Bills</p>
                <p className="text-sm text-ink-muted">{toExportBills.length} claims · {money(tot(toExportBills))} · one bill per person and currency</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a className={buttonClass("secondary", "sm")} href={`${base}/xero?${q({ kind: "bills" })}`}>Preview CSV</a>
                <a className={buttonClass("primary", "sm")} href={`${base}/xero?${q({ kind: "bills", mark: "1" })}`}>Download &amp; mark exported</a>
              </div>
            </div>
            {byCard.filter((c) => c.active || toExportCard(c.id).length).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
                <div>
                  <p className="font-medium">{c.name} ·· {c.last4} → Xero bank statement</p>
                  <p className="text-sm text-ink-muted">{toExportCard(c.id).length} claims · {money(tot(toExportCard(c.id)))}{c.unmatched ? ` · ${c.unmatched} statement lines still unmatched` : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a className={buttonClass("secondary", "sm")} href={`${base}/xero?${q({ kind: "card", card: c.id })}`}>Preview CSV</a>
                  <a className={buttonClass("primary", "sm")} href={`${base}/xero?${q({ kind: "card", card: c.id, mark: "1" })}`}>Download &amp; mark exported</a>
                </div>
              </div>
            ))}
            {unassignedCard.length ? <Notice tone="warn">{unassignedCard.length} card claim(s) have no card selected. Open them and choose the card in Bookkeeping, or match them from the card statement.</Notice> : null}
            <div className="flex flex-wrap gap-2 text-sm">
              <a className={buttonClass("secondary", "sm")} href={`${base}/export?month=${month}&status=approved&format=xlsx`}>Excel (all approved)</a>
              <a className={buttonClass("secondary", "sm")} href={`${base}/export?month=${month}&status=approved&format=zip`}>Excel + receipts (ZIP)</a>
            </div>
            <p className="text-xs text-ink-muted">In Xero: Business → Bills to pay → Import, choose <strong>Tax inclusive</strong>. Card files: Accounting → Bank accounts → the card → Import a statement. VAT is matched by tax rate name and accounts by code, as set in VAT &amp; accounts.</p>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="VAT summary (approved)" description="Per rate and currency. Foreign VAT isn’t reclaimable on a UK return." />
          {vatRows.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-ink-muted"><tr><th className="px-4 py-2 font-normal sm:px-5">Rate</th><th className="px-2 py-2 text-right font-normal">Gross</th><th className="px-2 py-2 text-right font-normal">VAT</th><th className="px-4 py-2 text-right font-normal sm:px-5">Net</th></tr></thead>
              <tbody className="divide-y divide-line">
                {vatRows.map((v) => (
                  <tr key={`${v.rate}-${v.currency}`}>
                    <td className="px-4 py-2 sm:px-5">{v.rate}{v.reclaimable ? "" : <span className="text-ink-muted"> (not reclaimable)</span>} <span className="text-ink-muted">· {v.count}</span></td>
                    <td className="tabular px-2 py-2 text-right">{formatMoney(v.gross, v.currency)}</td>
                    <td className="tabular px-2 py-2 text-right">{formatMoney(v.vat, v.currency)}</td>
                    <td className="tabular px-4 py-2 text-right sm:px-5">{formatMoney(Math.round((v.gross - v.vat) * 100) / 100, v.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">No approved claims this month.</p>}
        </Panel>

        <Panel>
          <PanelHeader title="Reimbursements due" description="Approved claims paid personally, across all months." />
          {duePeople.size ? (
            <ActionForm id="reimburse-due" action={markReimbursed} className="divide-y divide-line">
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              {[...duePeople.entries()].map(([m, list]) => (
                <label key={m} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="flex items-center gap-2">
                    {p.has("reimbursements.manage") && m !== ctx.membership.id ? <input type="checkbox" className="size-4" name="ids" value={list.map((r) => r.id).join(",")} /> : null}
                    {name.get(m) ?? "Former colleague"} <span className="text-ink-muted">· {list.length} claim{list.length === 1 ? "" : "s"}</span>
                  </span>
                  <span className="tabular font-medium">{money(tot(list))}</span>
                </label>
              ))}
              {p.has("reimbursements.manage") ? (
                <div className="flex flex-wrap items-end gap-3 px-4 py-3 sm:px-5">
                  <label className="min-w-40 flex-1 text-sm">Payment reference<input name="reference" maxLength={100} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2" /></label>
                  <SubmitButton size="sm" pendingLabel="Saving…">Mark selected as paid</SubmitButton>
                </div>
              ) : null}
            </ActionForm>
          ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">Nothing to reimburse.</p>}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {([
          ["By person", group((r) => name.get(r.membership_id) ?? "Former colleague")],
          ["By category", group((r) => (r.category_id ? catName.get(r.category_id) : null) ?? "Uncategorised")],
          ["By project", group((r) => (r.project_id ? projName.get(r.project_id) : null) ?? "No project")],
        ] as const).map(([title, groups]) => (
          <Panel key={title}>
            <PanelHeader title={`${title} (approved)`} />
            {groups.length ? (
              <ul className="divide-y divide-line text-sm">
                {groups.map(([k, list]) => (
                  <li key={k} className="flex justify-between gap-3 px-4 py-2 sm:px-5"><span className="truncate">{k}</span><span className="tabular">{money(tot(list))}</span></li>
                ))}
              </ul>
            ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">—</p>}
          </Panel>
        ))}
      </div>

      {p.has("expenses.export") ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Month close" description="Closing stops anyone submitting or changing claims dated in this month. You can reopen it." />
            <div className="p-4 sm:p-5">
              <InlineActionForm action={setPeriod} confirm={closed ? `Reopen ${monthLabel}?` : `Close ${monthLabel}? Staff won't be able to submit claims dated in it.`}>
                <input type="hidden" name="organization_id" value={ctx.org.id} />
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="closed" value={closed ? "0" : "1"} />
                <SubmitButton variant={closed ? "secondary" : "primary"} pendingLabel="Saving…">{closed ? `Reopen ${monthLabel}` : `Close ${monthLabel}`}</SubmitButton>
              </InlineActionForm>
              {!closed && (submitted.length || issues.length || toExport.length) ? <p className="mt-2 text-xs text-ink-muted">Still open: {submitted.length} waiting for approval, {issues.length} needing attention, {toExport.length} not exported.</p> : null}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Recent Xero exports" />
            {(exportsLog ?? []).length ? (
              <ul className="divide-y divide-line text-sm">
                {(exportsLog ?? []).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
                    <span>{x.kind === "xero_bills" ? "Bills" : "Card statement"} · {x.row_count} claims · {userName.get(x.actor_id) ?? "Former colleague"} · {formatDateTime(x.created_at, tz)}{x.undone_at ? " · undone" : ""}</span>
                    {!x.undone_at && x.row_count ? (
                      <InlineActionForm action={undoExport} confirm="Undo this export? The claims can then be exported again — make sure you deleted them in Xero first.">
                        <input type="hidden" name="id" value={x.id} />
                        <button type="submit" className="text-ink-muted underline">Undo</button>
                      </InlineActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 pb-4 text-sm text-ink-muted sm:px-5">No exports yet.</p>}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
