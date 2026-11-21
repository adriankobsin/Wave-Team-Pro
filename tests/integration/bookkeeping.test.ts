import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;
let card: string;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", books: "bookkeeper", bob: "employee", cara: "employee" });
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const id = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0].id as string;
const cat = (name: string) => id("select id from public.expense_categories where organization_id = $1 and name = $2", [f.orgA, name]);
const rate = (name: string) => id("select id from public.tax_rates where organization_id = $1 and name = $2", [f.orgA, name]);

async function claim(who: string, o: Record<string, unknown>) {
  const v = { merchant: "Shop", expense_date: "2026-04-04", currency: "GBP", total: 10, description: "Work", payment_method: "personal", ...o };
  const [{ id }] = await q(who, `insert into public.expenses (organization_id, membership_id, merchant, expense_date, currency, total, description, category_id, payment_method, no_receipt_reason, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'test', $10) returning id`, [f.orgA, f.m[who], v.merchant, v.expense_date, v.currency, v.total, v.description, await cat("Travel"), v.payment_method, f.u[who]]);
  return id as string;
}

describe("VAT rates and settings", () => {
  it("seeds UK VAT rates with Xero names", async () => {
    const rows = await q("bob", "select name, accounting_name, reclaimable from public.tax_rates where organization_id = $1 order by position", [f.orgA]);
    expect(rows[0]).toEqual({ name: "Standard 20%", accounting_name: "20% (VAT on Expenses)", reclaimable: true });
    expect(rows.find((r) => r.name.startsWith("Foreign"))?.reclaimable).toBe(false);
  });
  it("only finance can change them", async () => {
    await expect(q("bob", "insert into public.tax_rates (organization_id, name, rate, accounting_name) values ($1, 'Mine', 1, 'x')", [f.orgA])).rejects.toThrow(/row-level security/);
    await q("books", "insert into public.tax_rates (organization_id, name, rate, accounting_name) values ($1, 'Flat rate', 0, 'No VAT')", [f.orgA]);
  });
});

describe("company cards", () => {
  it("finance adds cards; holders see only their own; others see none", async () => {
    [{ id: card }] = await q("books", "insert into public.company_cards (organization_id, name, last4, holder_membership_id, currency) values ($1, 'Ops Amex', '1025', $2, 'GBP') returning id", [f.orgA, f.m.bob]);
    await expect(q("bob", "insert into public.company_cards (organization_id, name, last4, currency) values ($1, 'Mine', '1111', 'GBP')", [f.orgA])).rejects.toThrow(/row-level security/);
    expect(await q("bob", "select id from public.company_cards where id = $1", [card])).toHaveLength(1);
    expect(await q("cara", "select id from public.company_cards where id = $1", [card])).toHaveLength(0);
    expect(await q("outsider", "select id from public.company_cards where id = $1", [card])).toHaveLength(0);
  });

  it("an employee can't put a claim on someone else's card", async () => {
    const e = await claim("cara", { payment_method: "company_card" });
    await expect(q("cara", "update public.expenses set card_id = $1 where id = $2", [card, e])).rejects.toThrow(/card you hold/);
  });

  it("auto-matches statement lines to card claims within 3 days, one to one", async () => {
    const e1 = await claim("bob", { payment_method: "company_card", merchant: "Farnell", total: 250.67, expense_date: "2026-04-01" });
    const e2 = await claim("bob", { payment_method: "company_card", merchant: "Taxi", total: 20, expense_date: "2026-04-10" });
    for (const [d, amt, desc, fp] of [["2026-04-02", 250.67, "FARNELL UK", "a"], ["2026-04-20", 20, "TAXI LATE", "b"], ["2026-04-05", 99, "UNKNOWN", "c"]] as const) {
      await q("books", "insert into public.card_transactions (organization_id, card_id, txn_date, description, amount, currency, fingerprint) values ($1, $2, $3, $4, $5, 'GBP', $6)", [f.orgA, card, d, desc, amt, fp]);
    }
    expect((await q("books", "select public.auto_match_card($1) n", [card]))[0].n).toBe(1);
    const [{ expense_id }] = await q("books", "select expense_id from public.card_transactions where fingerprint = 'a' and card_id = $1", [card]);
    expect(expense_id).toBe(e1);
    expect((await q("bob", "select card_id from public.expenses where id = $1", [e1]))[0].card_id).toBe(card);
    await expect(q("bob", "select public.auto_match_card($1)", [card])).rejects.toThrow(/Finance/);
    // manual match of the late taxi line
    const [{ id: late }] = await q("books", "select id from public.card_transactions where fingerprint = 'b' and card_id = $1", [card]);
    await q("books", "select public.set_card_transaction($1, 'match', $2)", [late, e2]);
    await expect(q("books", "select public.set_card_transaction($1, 'match', $2)", [(await q("books", "select id from public.card_transactions where fingerprint = 'c'"))[0].id, e2])).rejects.toThrow(/already matched/);
  });

  it("requesting a receipt creates a draft for the holder and notifies them", async () => {
    const [{ id: t }] = await q("books", "select id from public.card_transactions where fingerprint = 'c' and card_id = $1", [card]);
    const [{ e }] = await q("books", "select public.request_card_receipt($1) e", [t]);
    const [row] = await q("bob", "select membership_id, status, total::float, payment_method, card_id, reimbursable from public.expenses where id = $1", [e]);
    expect(row).toEqual({ membership_id: f.m.bob, status: "draft", total: 99, payment_method: "company_card", card_id: card, reimbursable: false });
    expect(await q("bob", "select id from public.notifications where user_id = $1 and title like 'Receipt needed%'", [f.u.bob])).toHaveLength(1);
  });

  it("statement lines are visible to finance and the holder only", async () => {
    expect((await q("bob", "select count(*)::int n from public.card_transactions where card_id = $1", [card]))[0].n).toBe(3);
    expect((await q("cara", "select count(*)::int n from public.card_transactions where card_id = $1", [card]))[0].n).toBe(0);
  });
});

describe("coding, export and month close", () => {
  let e: string;
  beforeAll(async () => {
    e = await claim("cara", { merchant: "ChaCha Denia", currency: "EUR", total: 56, expense_date: "2026-04-04" });
    await q("cara", "select public.submit_expense($1)", [e]);
  });

  it("finance codes VAT on a submitted claim, recorded in history", async () => {
    await expect(q("cara", "select public.code_expense($1, null, $2, 5.09, null, null)", [e, await rate("Foreign tax (not reclaimable)")])).rejects.toThrow(/cannot code/);
    await q("books", "select public.code_expense($1, $2, $3, 5.09, null, 'Spanish IVA')", [e, await cat("Meals"), await rate("Foreign tax (not reclaimable)")]);
    const [row] = await q("cara", "select tax_amount::float, tax_rate_id is not null coded from public.expenses where id = $1", [e]);
    expect(row).toEqual({ tax_amount: 5.09, coded: true });
    expect(await q("cara", "select id from public.expense_events where expense_id = $1 and event = 'corrected'", [e])).toHaveLength(1);
    await expect(q("books", "select public.code_expense($1, null, null, 999, null, null)", [e])).rejects.toThrow(/VAT must be/);
  });

  it("marks approved claims exported once, blocks later changes, and can undo", async () => {
    await q("books", "select public.review_expense($1, true)", [e]);
    const [{ x }] = await q("books", "select public.mark_accounting_export($1, 'xero_bills', array[$2]::uuid[], '{}'::jsonb) x", [f.orgA, e]);
    expect((await q("books", "select row_count from public.accounting_exports where id = $1", [x]))[0].row_count).toBe(1);
    const [{ x: again }] = await q("books", "select public.mark_accounting_export($1, 'xero_bills', array[$2]::uuid[], '{}'::jsonb) x", [f.orgA, e]);
    expect((await q("books", "select row_count from public.accounting_exports where id = $1", [again]))[0].row_count).toBe(0);
    await expect(q("books", "select public.code_expense($1, null, null, 1, null, null)", [e])).rejects.toThrow(/Already exported/);
    await expect(q("bob", "select public.mark_accounting_export($1, 'xero_bills', array[$2]::uuid[], '{}'::jsonb)", [f.orgA, e])).rejects.toThrow(/expenses.export/);
    expect((await q("books", "select public.undo_accounting_export($1) n", [x]))[0].n).toBe(1);
    expect((await q("cara", "select accounting_export_id from public.expenses where id = $1", [e]))[0].accounting_export_id).toBeNull();
  });

  it("closing a month blocks new claims and submissions dated in it; reopening allows them", async () => {
    await expect(q("bob", "select public.set_period_closed($1, '2026-03-01', true)", [f.orgA])).rejects.toThrow(/expenses.export/);
    await q("books", "select public.set_period_closed($1, '2026-03-15', true)", [f.orgA]);
    await expect(claim("bob", { expense_date: "2026-03-20" })).rejects.toThrow(/books for Mar 2026 are closed/);
    const d = await claim("bob", { expense_date: "2026-04-20" });
    await expect(q("bob", "update public.expenses set expense_date = '2026-03-10' where id = $1", [d])).rejects.toThrow(/closed/);
    await q("books", "select public.set_period_closed($1, '2026-03-01', false)", [f.orgA]);
    await q("bob", "update public.expenses set expense_date = '2026-03-10' where id = $1", [d]);
    await q("books", "select public.set_period_closed($1, '2026-03-01', true)", [f.orgA]);
    await expect(q("bob", "select public.submit_expense($1)", [d])).rejects.toThrow(/closed/);
  });
});

describe("duplicates with split receipts and card slips", () => {
  it("same file with a different amount is not a duplicate; same day and amount is", async () => {
    const a = await claim("cara", { merchant: "ChaCha", currency: "EUR", total: 74.5, expense_date: "2026-04-03" });
    const b = await claim("cara", { merchant: "Fuego", currency: "EUR", total: 25.5, expense_date: "2026-04-03" });
    for (const e of [a, b]) {
      await db.query(`insert into public.files (organization_id, storage_path, file_name, mime_type, size_bytes, sha256, context_type, context_id, uploaded_by)
        values ($1::uuid, $1::text || '/expense/' || $2::text || '/r.pdf', 'r.pdf', 'application/pdf', 100, $3, 'expense', $2::uuid, $4)`, [f.orgA, e, "b".repeat(64), f.u.cara]);
    }
    expect(await q("cara", "select * from public.expense_duplicates($1)", [b])).toHaveLength(0);
    const slip = await claim("cara", { merchant: "IberCaja", currency: "EUR", total: 25.5, expense_date: "2026-04-03" });
    const d = await q("cara", "select id, reason from public.expense_duplicates($1)", [slip]);
    expect(d).toEqual([{ id: b, reason: "Same date and amount (receipt and card slip?)" }]);
  });
});

describe("country tax packs", () => {
  it("every supported country has a standard rate and the generic rates", async () => {
    for (const [c, std] of [["GB", 20], ["ES", 21], ["FR", 20], ["IT", 22], ["DE", 19], ["NL", 21], ["HR", 25], ["GR", 24], ["MT", 18], ["SG", 9], ["TH", 7], ["KH", 10]] as const) {
      const rows = (await db.query("select name, rate::float, reclaimable from public.tax_rate_pack($1)", [c])).rows;
      expect(rows[0].rate, c).toBe(std);
      expect(rows.some((r) => r.name === "Foreign tax (not reclaimable)" && !r.reclaimable), c).toBe(true);
    }
  });
  it("finance can load another country's rates; employees can't", async () => {
    await expect(q("bob", "select public.load_tax_rate_pack($1, 'SG')", [f.orgA])).rejects.toThrow(/cannot manage/);
    expect((await q("books", "select public.load_tax_rate_pack($1, 'SG') n", [f.orgA]))[0].n).toBe(4);
    expect((await q("books", "select public.load_tax_rate_pack($1, 'SG') n", [f.orgA]))[0].n).toBe(0);
  });
  it("a new Thai company starts with Thai VAT", async () => {
    const [{ id }] = await q("owner", "select public.create_organization('Acme TH', $1, 'THB', 'Asia/Bangkok', 'TH') as id", [`th-${f.tag}`]);
    const rows = (await db.query("select name from public.tax_rates where organization_id = $1 order by position", [id])).rows.map((r) => r.name);
    expect(rows[0]).toBe("VAT 7%");
  });
});
