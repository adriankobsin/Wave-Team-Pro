import type { Metadata } from "next";
import { CurrencySelect } from "@/components/ui/region-select";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { autoMatch, cardLineAction, importStatement, saveCard } from "@/server/actions/bookkeeping";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Company cards" };

const STATUS_TONE = { unmatched: "warn", matched: "ok", ignored: "neutral" } as const;

export default async function CardsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ card?: string; show?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.has("expenses.export") && !ctx.perms.has("reimbursements.manage")) {
    return <AccessDenied message="Company cards are managed by bookkeepers." hint="Ask your bookkeeper or an administrator." />;
  }
  const supabase = await createClient();
  const [{ data: cards }, people] = await Promise.all([
    supabase.from("company_cards").select("*").eq("organization_id", ctx.org.id).order("active", { ascending: false }).order("name"),
    listPeople(ctx.org.id),
  ]);
  const selected = (cards ?? []).find((c) => c.id === sp.card) ?? (cards ?? [])[0];
  const show = sp.show === "all" || sp.show === "matched" || sp.show === "ignored" ? sp.show : "unmatched";
  const holder = new Map(people.map((p) => [p.membershipId, p.name]));
  const base = `/o/${ctx.org.slug}/expenses`;

  let lines: { id: string; txn_date: string; description: string; amount: number; currency: string; reference: string | null; status: "unmatched" | "matched" | "ignored"; expense_id: string | null; note: string | null }[] = [];
  let counts: Record<string, number> = {};
  let candidates: { id: string; merchant: string | null; expense_date: string | null; total: number | null; currency: string | null; membership_id: string }[] = [];
  if (selected) {
    let q = supabase.from("card_transactions").select("id, txn_date, description, amount, currency, reference, status, expense_id, note").eq("card_id", selected.id).order("txn_date", { ascending: false }).limit(300);
    if (show !== "all") q = q.eq("status", show);
    const [{ data: l }, { data: all }, { data: cands }] = await Promise.all([
      q,
      supabase.from("card_transactions").select("status").eq("card_id", selected.id),
      supabase.from("expenses").select("id, merchant, expense_date, total, currency, membership_id").eq("organization_id", ctx.org.id)
        .eq("payment_method", "company_card").in("status", ["draft", "submitted", "approved"]).order("expense_date", { ascending: false }).limit(400),
    ]);
    lines = (l ?? []).map((x) => ({ ...x, amount: Number(x.amount) }));
    counts = (all ?? []).reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {} as Record<string, number>);
    const { data: taken } = await supabase.from("card_transactions").select("expense_id").eq("organization_id", ctx.org.id).not("expense_id", "is", null);
    const used = new Set((taken ?? []).map((t) => t.expense_id));
    candidates = (cands ?? []).filter((c) => !used.has(c.id)).map((c) => ({ ...c, total: c.total === null ? null : Number(c.total) }));
  }
  const suggest = (t: (typeof lines)[number]) =>
    candidates
      .filter((c) => c.currency === t.currency && c.total !== null && Math.abs(c.total - t.amount) < 0.005)
      .sort((a, b) => Math.abs(Date.parse(a.expense_date ?? "") - Date.parse(t.txn_date)) - Math.abs(Date.parse(b.expense_date ?? "") - Date.parse(t.txn_date)))
      .slice(0, 3);

  return (
    <div className="space-y-6">
      <Link href={`${base}/bookkeeping`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Bookkeeping</Link>
      <PageHeader title="Company cards" description="Import card statements, match each payment to its receipt, and chase card holders for missing ones." />

      <div className="flex flex-wrap gap-2">
        {(cards ?? []).map((c) => (
          <Link key={c.id} href={`${base}/cards?card=${c.id}`} aria-current={c.id === selected?.id ? "page" : undefined}
            className={cn("rounded-lg border px-3 py-2 text-sm", c.id === selected?.id ? "border-brass bg-panel font-medium" : "border-line bg-panel text-ink-muted hover:text-ink", !c.active && "opacity-60")}>
            {c.name} ·· {c.last4}
            <span className="block text-xs text-ink-muted">{c.holder_membership_id ? holder.get(c.holder_membership_id) ?? "Former colleague" : "No holder"} · {c.currency}</span>
          </Link>
        ))}
      </div>

      {selected ? (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Panel>
              <PanelHeader title="Import a statement" description="Export the card statement from your bank as CSV. Re-importing the same file adds nothing twice." />
              <ActionForm action={importStatement} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5" resetOnSuccess>
                <input type="hidden" name="organization_id" value={ctx.org.id} />
                <input type="hidden" name="card_id" value={selected.id} />
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="stmt">Statement CSV</label>
                  <input id="stmt" type="file" name="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm" />
                </div>
                <SelectField label="Dates look like" name="date_order" defaultValue={ctx.org.country === "US" ? "mdy" : "dmy"}>
                  <option value="dmy">31/12/2026 (day first)</option>
                  <option value="mdy">12/31/2026 (month first)</option>
                  <option value="ymd">2026-12-31</option>
                </SelectField>
                <SelectField label="Spending appears as" name="spend_sign" defaultValue="negative">
                  <option value="negative">Negative amounts (−12.50)</option>
                  <option value="positive">Positive amounts (12.50)</option>
                </SelectField>
                <div className="sm:col-span-2"><SubmitButton pendingLabel="Importing…">Import and match</SubmitButton></div>
              </ActionForm>
            </Panel>
            <Panel>
              <PanelHeader title={`${selected.name} ·· ${selected.last4}`} />
              <dl className="grid grid-cols-3 divide-x divide-line text-center">
                {(["unmatched", "matched", "ignored"] as const).map((k) => (
                  <div key={k} className="px-2 py-4"><dt className="text-xs text-ink-muted capitalize">{k}</dt><dd className="tabular text-2xl font-semibold">{counts[k] ?? 0}</dd></div>
                ))}
              </dl>
              <div className="border-t border-line p-4 sm:p-5">
                <InlineActionForm action={autoMatch}>
                  <input type="hidden" name="card_id" value={selected.id} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Matching…">Match again</SubmitButton>
                </InlineActionForm>
                <p className="mt-2 text-xs text-ink-muted">Automatic matching pairs a line with a card expense of the same amount and currency within 3 days.</p>
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              title="Statement lines"
              action={
                <nav className="flex gap-1 text-sm">
                  {(["unmatched", "matched", "ignored", "all"] as const).map((k) => (
                    <Link key={k} href={`${base}/cards?card=${selected.id}&show=${k}`} className={cn("rounded px-2 py-1 capitalize", k === show ? "bg-panel-sunk font-medium" : "text-ink-muted")}>{k}</Link>
                  ))}
                </nav>
              }
            />
            {lines.length ? (
              <ul className="divide-y divide-line">
                {lines.map((t) => (
                  <li key={t.id} className="space-y-2 px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{t.description}</p>
                        <p className="text-sm text-ink-muted">{t.txn_date}{t.reference ? ` · ${t.reference}` : ""}{t.note ? ` · ${t.note}` : ""}</p>
                      </div>
                      <div className="text-right">
                        <p className="tabular font-semibold">{formatMoney(t.amount, t.currency)}</p>
                        <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                      </div>
                    </div>
                    {t.status === "matched" && t.expense_id ? (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <Link href={`${base}/${t.expense_id}`} className="underline">Open matched expense</Link>
                        <InlineActionForm action={cardLineAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="action" value="unmatch" /><button type="submit" className="text-ink-muted underline">Unmatch</button></InlineActionForm>
                      </div>
                    ) : null}
                    {t.status === "unmatched" ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        {suggest(t).map((c) => (
                          <InlineActionForm key={c.id} action={cardLineAction}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="action" value="match" />
                            <input type="hidden" name="expense_id" value={c.id} />
                            <button type="submit" className="underline">Match: {c.merchant ?? "Expense"} {c.expense_date} ({holder.get(c.membership_id) ?? "colleague"})</button>
                          </InlineActionForm>
                        ))}
                        {selected.holder_membership_id ? (
                          <InlineActionForm action={cardLineAction}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="action" value="request" />
                            <button type="submit" className="font-medium underline">Ask {holder.get(selected.holder_membership_id) ?? "holder"} for the receipt</button>
                          </InlineActionForm>
                        ) : null}
                        <InlineActionForm action={cardLineAction} confirm="Ignore this line (e.g. bank fee or personal spend repaid)?">
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="action" value="ignore" />
                          <button type="submit" className="text-ink-muted underline">Ignore</button>
                        </InlineActionForm>
                      </div>
                    ) : null}
                    {t.status === "ignored" ? (
                      <InlineActionForm action={cardLineAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="action" value="unmatch" /><button type="submit" className="text-sm text-ink-muted underline">Restore</button></InlineActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={show === "unmatched" ? "Every imported line is matched" : "No lines"}>Import a statement to start reconciling.</EmptyState>
            )}
          </Panel>

          <Panel>
            <details>
              <summary className="cursor-pointer px-4 py-3 font-semibold sm:px-5">Edit card</summary>
              <CardForm orgId={ctx.org.id} people={people} card={selected} />
            </details>
          </Panel>
        </>
      ) : (
        <EmptyState title="No company cards yet">Add the cards your team uses below.</EmptyState>
      )}

      <Panel>
        <PanelHeader title="Add a company card" description="Only the last 4 digits are stored. Never enter a full card number." />
        <CardForm orgId={ctx.org.id} people={people} />
      </Panel>
    </div>
  );
}

function CardForm({ orgId, people, card }: { orgId: string; people: { membershipId: string; name: string }[]; card?: { id: string; name: string; last4: string; holder_membership_id: string | null; currency: string; account_code: string | null; active: boolean } }) {
  return (
    <ActionForm action={saveCard} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3 sm:p-5" resetOnSuccess={!card}>
      <input type="hidden" name="organization_id" value={orgId} />
      {card ? <input type="hidden" name="id" value={card.id} /> : null}
      <TextField label="Name" name="name" required maxLength={60} defaultValue={card?.name ?? ""} placeholder="e.g. Amex – Operations" />
      <TextField label="Last 4 digits" name="last4" required inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={card?.last4 ?? ""} />
      <SelectField label="Card holder" name="holder_membership_id" optional defaultValue={card?.holder_membership_id ?? ""}>
        <option value="">—</option>
        {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
      </SelectField>
      <CurrencySelect label="Currency" name="currency" required defaultValue={card?.currency ?? "GBP"} />
      <TextField label="Xero bank account code" name="account_code" optional maxLength={32} defaultValue={card?.account_code ?? ""} />
      <div className="pt-6">{card ? <CheckboxField name="active" defaultChecked={card.active} label="Active" /> : <input type="hidden" name="active" value="on" />}</div>
      <div className="sm:col-span-3"><SubmitButton variant="secondary" pendingLabel="Saving…">{card ? "Save card" : "Add card"}</SubmitButton></div>
    </ActionForm>
  );
}
