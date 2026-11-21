import type { Metadata } from "next";
import { CurrencySelect } from "@/components/ui/region-select";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FileText } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { listExpenses } from "@/server/services/expenses";
import { addReceipts, cancelExpense, codeExpense, correctExpense, markReimbursed, removeReceipt, retryReading, reviewExpense, saveExpense, splitReceipt } from "@/server/actions/expenses";
import { aiProviderLabel } from "@/lib/ai/provider";
import { checkReceipt, readingWarnings, receiptExtraction, type Confidence, type ReceiptExtraction } from "@/lib/ai/receipt-schema";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ReviewForm } from "@/components/ui/review-form";
import { PersonLabel } from "@/components/ui/avatar";
import { Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { ReceiptPicker } from "@/components/expenses/receipt-picker";
import { EXPENSE_STATUS, EXPENSE_TONE, PAYMENT_LABEL, READING_LABEL, REIMBURSE_LABEL } from "@/components/expenses/labels";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Expense" };

const EVENT_LABEL: Record<string, string> = {
  created: "Created", submitted: "Submitted", approved: "Approved", rejected: "Returned for changes", cancelled: "Withdrawn",
  corrected: "Corrected by reviewer", reimbursed: "Reimbursed", extracted: "Receipt read automatically", duplicate_override: "Confirmed as a separate purchase",
};
const FIELD_LABEL: Record<string, string> = {
  category_id: "Category", project_id: "Project", expense_date: "Date", merchant: "Merchant", currency: "Currency",
  subtotal: "Subtotal", tax_amount: "Tax", total: "Total",
};

function ConfidenceHint({ c }: { c?: Confidence }) {
  if (!c || c === "high") return null;
  return <span className="ml-1 rounded bg-brass-soft px-1.5 py-0.5 text-[0.6875rem] font-medium text-[#7a5a22] dark:text-brass">{c === "unreadable" ? "Not readable — enter it" : "Please check"}</span>;
}

export default async function ExpensePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const [e] = await listExpenses(ctx.org.id, { ids: [id], status: "any" });
  if (!e) notFound();
  const supabase = await createClient();
  const [{ data: canReview }, { data: categories }, { data: projects }, { data: events }, { data: readings }, { data: dups }, people] = await Promise.all([
    supabase.rpc("can_review_expense_row", { p_org: ctx.org.id, p_membership: e.membership_id, p_project: e.project_id }),
    supabase.from("expense_categories").select("id, name, receipt_required, active").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("projects").select("id, name, code").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("expense_events").select("id, event, actor_id, note, changes, created_at").eq("expense_id", id).order("created_at"),
    supabase.from("expense_ai_extractions").select("file_id, status, result, error, completed_at").eq("expense_id", id),
    supabase.rpc("expense_duplicates", { p_expense: id }),
    listPeople(ctx.org.id, { includeInactive: true }),
  ]);
  const [{ data: taxRates }, { data: cards }, { data: cardLine }] = await Promise.all([
    supabase.from("tax_rates").select("id, name, rate, reclaimable, active").eq("organization_id", ctx.org.id).order("position"),
    supabase.from("company_cards").select("id, name, last4, holder_membership_id, active").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("card_transactions").select("id, txn_date, description, amount, currency").eq("expense_id", id).maybeSingle(),
  ]);
  const isFinance = ctx.perms.has("expenses.export") || ctx.perms.has("reimbursements.manage");
  const myCards = (cards ?? []).filter((c) => c.active && (c.holder_membership_id === e.membership_id || c.id === e.card_id));
  const taxRate = (taxRates ?? []).find((t) => t.id === e.tax_rate_id);
  const card = (cards ?? []).find((c) => c.id === e.card_id);
  const parsedReadings = (readings ?? []).filter((r) => r.status === "done").map((r) => receiptExtraction.safeParse(r.result)).filter((r) => r.success).map((r) => r.data);
  const warnings = [...new Set(parsedReadings.flatMap(readingWarnings))];
  const extraReceipts = parsedReadings.flatMap((r) => r.other_receipts);
  const tz = ctx.profile.timezone;
  const mine = e.membership_id === ctx.membership.id;
  const editable = mine && (e.status === "draft" || e.status === "rejected");
  const byUser = new Map(people.map((p) => [p.userId, p]));
  const owner = people.find((p) => p.membershipId === e.membership_id);
  const category = (categories ?? []).find((c) => c.id === e.category_id);
  const project = (projects ?? []).find((p) => p.id === e.project_id);
  const reading = parsedReadings[0];
  const conf = (k: keyof ReceiptExtraction) => (reading ? (reading[k] as { confidence?: Confidence })?.confidence : undefined);
  const flags = reading ? checkReceipt(reading, todayIn(tz)) : [];
  const failed = (readings ?? []).find((r) => r.status === "failed");
  const reading_active = e.extraction_status === "pending" || e.extraction_status === "processing";
  const duplicates = (dups ?? []) as { id: string; reason: string; status: string }[];
  const amountsMismatch =
    e.subtotal !== null && e.total !== null &&
    Math.abs(e.subtotal + (e.tax_amount ?? 0) + (e.tip_amount ?? 0) - e.total) > 0.02 &&
    Math.abs(e.subtotal + (e.tip_amount ?? 0) - e.total) > 0.02;
  const base = `/o/${ctx.org.slug}/expenses`;
  const ai = aiProviderLabel();
  const canReimburse = ctx.perms.has("reimbursements.manage") && !mine && e.status === "approved" && e.reimbursement_status === "pending";

  return (
    <div className="space-y-6">
      {reading_active ? <LiveRefresh table="expenses" channel={`expense-${id}`} filter={`id=eq.${id}`} /> : null}
      <Link href={base} className="text-sm text-ink-muted underline-offset-4 hover:underline">Expenses</Link>
      <PageHeader
        title={e.merchant ?? "New expense"}
        description={[e.expense_date, e.total !== null && e.currency ? formatMoney(e.total, e.currency) : null, category?.name].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={EXPENSE_TONE[e.status]}>{EXPENSE_STATUS[e.status]}</Badge>
            {e.reimbursement_status !== "not_required" ? <Badge tone={e.reimbursement_status === "paid" ? "ok" : "neutral"}>{REIMBURSE_LABEL[e.reimbursement_status]}</Badge> : null}
          </div>
        }
      />

      {e.status === "rejected" && e.review_note ? <Notice tone="warn" title="Returned for changes">{e.review_note}</Notice> : null}
      {reading_active ? <Notice title={READING_LABEL[e.extraction_status]}>This usually takes a few seconds. The page updates by itself; you can also fill in fields now.</Notice> : null}
      {editable && e.extraction_status === "done" ? <Notice tone="ok" title="Receipt read">We filled in what we could read. Fields marked “Please check” were unclear. Nothing was guessed — empty fields weren’t readable.</Notice> : null}
      {warnings.length ? (
        <Notice tone="warn" title="Check this receipt">
          {warnings.map((w) => <span key={w} className="block">{w}</span>)}
        </Notice>
      ) : null}
      {editable && extraReceipts.length ? (
        <Panel>
          <PanelHeader title="Other receipts in this file" description="Each purchase needs its own expense. These copy the file and fill in what was read." />
          <ul className="divide-y divide-line">
            {extraReceipts.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span>{[r.merchant ?? "Unknown merchant", r.date, r.total !== null && r.currency ? formatMoney(r.total, r.currency) : null].filter(Boolean).join(" · ")}</span>
                <InlineActionForm action={splitReceipt}>
                  <input type="hidden" name="expense_id" value={id} />
                  <input type="hidden" name="index" value={i} />
                  <input type="hidden" name="org_slug" value={ctx.org.slug} />
                  <button type="submit" className="font-medium underline">Create separate expense</button>
                </InlineActionForm>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {editable && failed ? (
        <Notice tone="warn" title="We couldn't read this receipt">
          Enter the details yourself{ai ? ", or try reading it again." : "."}
          {ai ? (
            <InlineActionForm action={retryReading}>
              <input type="hidden" name="expense_id" value={id} />
              <button type="submit" className="ml-2 font-medium underline">Try again</button>
            </InlineActionForm>
          ) : null}
        </Notice>
      ) : null}
      {duplicates.length && e.status !== "approved" ? (
        <Notice tone="warn" title="Possible duplicate">
          {duplicates.map((d) => (
            <span key={d.id} className="block">
              {d.reason}: <Link className="underline" href={`${base}/${d.id}`}>another expense</Link> ({EXPENSE_STATUS[d.status as keyof typeof EXPENSE_STATUS] ?? d.status})
            </span>
          ))}
          {e.duplicate_override ? <span className="mt-1 block">The submitter confirmed this is a separate purchase.</span> : null}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel>
          <PanelHeader title={`Receipt${e.receipts.length > 1 ? "s" : ""}`} />
          <div className="space-y-3 p-4 sm:p-5">
            {e.receipts.length ? (
              e.receipts.map((f) => (
                <div key={f.id} className="space-y-2">
                  {f.mime_type.startsWith("image/") ? (
                    <a href={`/files/${f.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/files/${f.id}`} alt={`Receipt ${f.file_name}`} className="max-h-[32rem] w-full rounded-md border border-line bg-panel-sunk object-contain" />
                    </a>
                  ) : (
                    <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-line p-3 text-sm underline-offset-4 hover:underline">
                      <FileText className="size-5" aria-hidden /> {f.file_name}
                    </a>
                  )}
                  {editable ? (
                    <InlineActionForm action={removeReceipt} confirm="Remove this receipt?">
                      <input type="hidden" name="file_id" value={f.id} />
                      <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
                    </InlineActionForm>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-muted">No receipt attached{e.no_receipt_reason ? `: “${e.no_receipt_reason}”` : "."}</p>
            )}
            {editable && e.receipts.length < 5 ? (
              <ActionForm action={addReceipts} className="space-y-3 border-t border-line pt-3" resetOnSuccess>
                <input type="hidden" name="expense_id" value={id} />
                <ReceiptPicker required />
                {ai ? <CheckboxField name="auto_read" defaultChecked label="Read it automatically" hint={`Sent to ${ai} for reading.`} /> : null}
                <SubmitButton variant="secondary" size="sm" pendingLabel="Uploading…">Add receipt</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </Panel>

        <div className="space-y-6">
          {editable ? (
            <Panel>
              <PanelHeader title="Details" description="Check every field against the receipt before submitting." />
              <ActionForm action={saveExpense} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                <input type="hidden" name="id" value={id} />
                <TextField label="Merchant" name="merchant" defaultValue={e.merchant ?? ""} maxLength={200} hint={undefined} />
                <TextField label="Date on receipt" name="expense_date" type="date" defaultValue={e.expense_date ?? ""} />
                <div className="-mt-3 text-xs sm:col-span-2"><ConfidenceHint c={conf("merchant")} />{conf("date") && conf("date") !== "high" ? <><span className="text-ink-muted"> date:</span><ConfidenceHint c={conf("date")} /></> : null}</div>
                <SelectField label="Category" name="category_id" defaultValue={e.category_id ?? ""}>
                  <option value="">Choose</option>
                  {(categories ?? []).filter((c) => c.active || c.id === e.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.receipt_required ? "" : " (receipt optional)"}</option>)}
                </SelectField>
                {ctx.perms.has("work.self_manage") ? (
                  <SelectField label="Project" name="project_id" optional defaultValue={e.project_id ?? ""}>
                    <option value="">No project</option>
                    {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>)}
                  </SelectField>
                ) : null}
                <CurrencySelect label="Currency" name="currency" defaultValue={e.currency ?? ctx.org.base_currency} />
                <TextField label="Total" name="total" type="number" inputMode="decimal" step="0.01" min={0} defaultValue={e.total ?? ""} />
                <TextField label="Subtotal" name="subtotal" type="number" inputMode="decimal" step="0.01" min={0} optional defaultValue={e.subtotal ?? ""} />
                <TextField label="Tax (VAT/GST)" name="tax_amount" type="number" inputMode="decimal" step="0.01" min={0} optional defaultValue={e.tax_amount ?? ""} />
                <TextField label="Tip" name="tip_amount" type="number" inputMode="decimal" step="0.01" min={0} optional defaultValue={e.tip_amount ?? ""} />
                <TextField label="Receipt / invoice no." name="reference" optional defaultValue={e.reference ?? ""} maxLength={100} />
                <div className="text-xs sm:col-span-2">
                  {["total", "subtotal", "currency"].map((k) => conf(k as keyof ReceiptExtraction) && conf(k as keyof ReceiptExtraction) !== "high" ? <span key={k} className="mr-3"><span className="text-ink-muted">{k}:</span><ConfidenceHint c={conf(k as keyof ReceiptExtraction)} /></span> : null)}
                  {amountsMismatch ? <p className="text-[#7a5a22] dark:text-brass">Subtotal, tax and tip don’t add up to the total. Check the amounts (discounts can explain a difference).</p> : null}
                  {flags.filter((f) => f.field === "date").map((f) => <p key={f.field} className="text-[#7a5a22] dark:text-brass">{f.message}</p>)}
                </div>
                <TextField label="Supplier tax number" name="tax_number" optional defaultValue={e.tax_number ?? ""} maxLength={60} />
                <SelectField label="Paid with" name="payment_method" defaultValue={e.payment_method}>
                  {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                {(taxRates ?? []).length ? (
                  <SelectField label="VAT rate" name="tax_rate_id" optional defaultValue={e.tax_rate_id ?? ""}>
                    <option value="">Not sure</option>
                    {(taxRates ?? []).filter((t) => t.active || t.id === e.tax_rate_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </SelectField>
                ) : null}
                {myCards.length ? (
                  <SelectField label="Company card" name="card_id" optional defaultValue={e.card_id ?? ""}>
                    <option value="">—</option>
                    {myCards.map((c) => <option key={c.id} value={c.id}>{c.name} ·· {c.last4}</option>)}
                  </SelectField>
                ) : null}
                <div className="sm:col-span-2"><TextAreaField label="Business purpose" name="description" rows={2} maxLength={1000} defaultValue={e.description ?? ""} /></div>
                <div className="sm:col-span-2"><CheckboxField name="reimbursable" defaultChecked={e.reimbursable} label="I paid this myself and want to be reimbursed" hint="Ignored for company card payments." /></div>
                {!e.receipts.length ? <div className="sm:col-span-2"><TextField label="Why is there no receipt?" name="no_receipt_reason" optional defaultValue={e.no_receipt_reason ?? ""} maxLength={300} hint="Required for categories that need a receipt." /></div> : null}
                {duplicates.length ? <div className="sm:col-span-2"><CheckboxField name="confirm_repeat" label="This is a separate purchase, not a duplicate" hint="Reviewers will see this confirmation." /></div> : null}
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <SubmitButton name="intent" value="submit" pendingLabel="Submitting…">Submit for approval</SubmitButton>
                  <SubmitButton name="intent" value="save" variant="secondary" pendingLabel="Saving…">Save draft</SubmitButton>
                </div>
                <p className="text-xs text-ink-muted sm:col-span-2">Expense categories describe what was bought; whether something is tax-deductible is decided by your accountant, not by this app.</p>
              </ActionForm>
            </Panel>
          ) : (
            <Panel>
              <PanelHeader title="Details" />
              <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 sm:p-5">
                <div><dt className="text-ink-muted">Submitted by</dt><dd className="mt-1">{owner ? <PersonLabel id={owner.userId} name={owner.name} src={owner.avatarUrl} sub={owner.jobTitle} /> : "Former colleague"}</dd></div>
                <div><dt className="text-ink-muted">Date on receipt</dt><dd>{e.expense_date ?? "—"}</dd></div>
                <div><dt className="text-ink-muted">Category</dt><dd>{category?.name ?? "—"}</dd></div>
                <div><dt className="text-ink-muted">Project</dt><dd>{project ? <Link className="underline" href={`/o/${ctx.org.slug}/projects/${project.id}`}>{project.name}</Link> : "—"}</dd></div>
                <div><dt className="text-ink-muted">Total</dt><dd className="tabular font-semibold">{e.total !== null && e.currency ? formatMoney(e.total, e.currency) : "—"}</dd></div>
                <div><dt className="text-ink-muted">Subtotal / tax / tip</dt><dd className="tabular">{[e.subtotal, e.tax_amount, e.tip_amount].map((v) => (v === null ? "—" : v.toFixed(2))).join(" / ")}</dd></div>
                <div><dt className="text-ink-muted">In {e.reporting_currency ?? ctx.org.base_currency}</dt><dd className="tabular">{e.reporting_total !== null ? `${formatMoney(e.reporting_total, e.reporting_currency!)}${e.fx_rate !== 1 ? ` (rate ${e.fx_rate} on ${e.fx_date}, ${e.fx_source})` : ""}` : e.currency && e.currency !== ctx.org.base_currency ? "No exchange rate yet" : "—"}</dd></div>
                <div><dt className="text-ink-muted">Paid with</dt><dd>{PAYMENT_LABEL[e.payment_method as keyof typeof PAYMENT_LABEL]}{card ? ` · ${card.name} ·· ${card.last4}` : ""}{cardLine ? " · matched to card statement" : ""}</dd></div>
                <div><dt className="text-ink-muted">VAT</dt><dd>{taxRate ? `${taxRate.name}${taxRate.reclaimable ? "" : " (not reclaimable)"}` : "Not coded"}{e.tax_amount !== null && e.currency ? ` · ${formatMoney(e.tax_amount, e.currency)}` : ""}</dd></div>
                <div><dt className="text-ink-muted">Accounting</dt><dd>{e.accounting_exported_at ? `Exported ${formatDateTime(e.accounting_exported_at, tz)}` : "Not exported yet"}</dd></div>
                <div><dt className="text-ink-muted">Reference</dt><dd>{e.reference ?? "—"}{e.tax_number ? ` · Tax no. ${e.tax_number}` : ""}</dd></div>
                <div><dt className="text-ink-muted">Reimbursement</dt><dd>{REIMBURSE_LABEL[e.reimbursement_status]}{e.reimbursement_reference ? ` (${e.reimbursement_reference})` : ""}</dd></div>
                <div className="sm:col-span-2"><dt className="text-ink-muted">Business purpose</dt><dd className="whitespace-pre-wrap">{e.description ?? "—"}</dd></div>
              </dl>
            </Panel>
          )}

          {canReview && e.status === "submitted" ? (
            <Panel>
              <PanelHeader title="Review" description="Approving confirms the claim is a valid business expense. Reimbursement is recorded separately." />
              <div className="space-y-4 p-4 sm:p-5">
                {amountsMismatch ? <Notice tone="warn">The amounts don’t add up — check before approving.</Notice> : null}
                {!e.receipts.length ? <Notice tone="warn">No receipt: “{e.no_receipt_reason ?? "no reason given"}”.</Notice> : null}
                <ReviewForm action={reviewExpense} id={id} rejectNeedsNote rejectLabel="Return for changes" />
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Correct the details</summary>
                  <ActionForm action={correctExpense} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={id} />
                    <SelectField label="Category" name="category_id" defaultValue={e.category_id ?? ""}>
                      {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </SelectField>
                    <SelectField label="Project" name="project_id" optional defaultValue={e.project_id ?? ""}>
                      <option value="">No project</option>
                      {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </SelectField>
                    <TextField label="Merchant" name="merchant" defaultValue={e.merchant ?? ""} />
                    <TextField label="Date" name="expense_date" type="date" defaultValue={e.expense_date ?? ""} />
                    <CurrencySelect label="Currency" name="currency" defaultValue={e.currency ?? ""} />
                    <TextField label="Total" name="total" type="number" step="0.01" min={0} defaultValue={e.total ?? ""} />
                    <TextField label="Subtotal" name="subtotal" type="number" step="0.01" min={0} optional defaultValue={e.subtotal ?? ""} />
                    <TextField label="Tax" name="tax_amount" type="number" step="0.01" min={0} optional defaultValue={e.tax_amount ?? ""} />
                    <div className="sm:col-span-2"><TextField label="Reason for correction" name="note" required maxLength={500} /></div>
                    <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Saving…">Save correction</SubmitButton></div>
                  </ActionForm>
                </details>
              </div>
            </Panel>
          ) : null}

          {(isFinance || canReview) && (e.status === "submitted" || e.status === "approved") && !e.accounting_export_id ? (
            <Panel>
              <PanelHeader title="Bookkeeping" description="Code the claim for accounting. Changes are recorded in the history." />
              <ActionForm action={codeExpense} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                <input type="hidden" name="id" value={id} />
                <SelectField label="Category / account" name="category_id" defaultValue={e.category_id ?? ""}>
                  {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectField>
                <SelectField label="VAT rate" name="tax_rate_id" optional defaultValue={e.tax_rate_id ?? ""}>
                  <option value="">Not coded</option>
                  {(taxRates ?? []).filter((t) => t.active || t.id === e.tax_rate_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </SelectField>
                <TextField label={`VAT amount (${e.currency ?? ""})`} name="tax_amount" type="number" step="0.01" min={0} optional defaultValue={e.tax_amount ?? ""} />
                <SelectField label="Company card" name="card_id" optional defaultValue={e.card_id ?? ""}>
                  <option value="">Not a company card</option>
                  {(cards ?? []).filter((c) => c.active || c.id === e.card_id).map((c) => <option key={c.id} value={c.id}>{c.name} ·· {c.last4}</option>)}
                </SelectField>
                <div className="sm:col-span-2"><TextField label="Note" name="note" optional maxLength={500} placeholder="e.g. Foreign VAT, not reclaimable" /></div>
                <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Saving…">Save coding</SubmitButton></div>
              </ActionForm>
            </Panel>
          ) : null}

          {canReimburse ? (
            <Panel>
              <PanelHeader title="Reimbursement" />
              <ActionForm action={markReimbursed} className="flex flex-wrap items-end gap-3 p-4 sm:p-5">
                <input type="hidden" name="organization_id" value={ctx.org.id} />
                <input type="hidden" name="ids" value={id} />
                <div className="min-w-48 flex-1"><TextField label="Payment reference" name="reference" optional maxLength={100} /></div>
                <SubmitButton pendingLabel="Saving…">Mark as reimbursed</SubmitButton>
              </ActionForm>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="History" />
            <ol className="divide-y divide-line text-sm">
              {(events ?? []).map((ev) => {
                const who = ev.actor_id ? byUser.get(ev.actor_id)?.name ?? "Former colleague" : "System";
                const changes = (ev.changes ?? {}) as Record<string, unknown>;
                return (
                  <li key={ev.id} className="px-4 py-2.5 sm:px-5">
                    <p><strong>{EVENT_LABEL[ev.event] ?? ev.event}</strong> <span className="text-ink-muted">· {who} · {formatDateTime(ev.created_at, tz)}</span></p>
                    {ev.note ? <p className="text-ink-muted">“{ev.note}”</p> : null}
                    {ev.event === "corrected" ? (
                      <ul className="text-xs text-ink-muted">
                        {Object.entries(changes).map(([k, v]) => {
                          const [from, to] = v as [unknown, unknown];
                          const show = (x: unknown) => (k === "category_id" ? (categories ?? []).find((c) => c.id === x)?.name : k === "project_id" ? (projects ?? []).find((p) => p.id === x)?.name : x) ?? "—";
                          return <li key={k}>{FIELD_LABEL[k] ?? k}: {String(show(from))} → {String(show(to))}</li>;
                        })}
                      </ul>
                    ) : null}
                    {ev.event === "extracted" && Array.isArray(changes.filled) ? <p className="text-xs text-ink-muted">Filled: {(changes.filled as string[]).join(", ") || "nothing new"}</p> : null}
                  </li>
                );
              })}
            </ol>
          </Panel>

          {mine && ["draft", "rejected", "submitted"].includes(e.status) ? (
            <InlineActionForm action={cancelExpense} confirm="Withdraw this expense? It will no longer be reviewed.">
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="text-sm text-danger underline">Withdraw expense</button>
            </InlineActionForm>
          ) : null}
        </div>
      </div>
    </div>
  );
}
