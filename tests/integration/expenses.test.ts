import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", books: "bookkeeper", lead: "team_leader", bob: "employee", cara: "employee" });
  await db.query("update public.organization_memberships set manager_membership_id = $1 where id = $2", [f.m.lead, f.m.bob]);
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const cat = async (name: string) => (await db.query("select id from public.expense_categories where organization_id = $1 and name = $2", [f.orgA, name])).rows[0].id as string;

async function draft(who: string, extra: Record<string, unknown> = {}) {
  const v = { merchant: "Harbour Fuel", expense_date: "2026-10-01", currency: "GBP", total: 42.5, description: "Van fuel", category_id: await cat("Fuel & mileage"), ...extra };
  const [{ id }] = await q(who, `insert into public.expenses (organization_id, membership_id, merchant, expense_date, currency, total, description, category_id, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [f.orgA, f.m[who], v.merchant, v.expense_date, v.currency, v.total, v.description, v.category_id, f.u[who]]);
  return id as string;
}

describe("expense capture", () => {
  it("seeds categories for every organization", async () => {
    expect((await q("bob", "select count(*)::int n from public.expense_categories where organization_id = $1", [f.orgA]))[0].n).toBeGreaterThanOrEqual(8);
  });

  it("employees create their own drafts only, and cannot forge workflow fields", async () => {
    const id = await draft("bob");
    const [row] = await q("bob", "select status, created_by, reimbursement_status from public.expenses where id = $1", [id]);
    expect(row).toMatchObject({ status: "draft", created_by: f.u.bob, reimbursement_status: "not_required" });
    await expect(q("bob", `insert into public.expenses (organization_id, membership_id, created_by) values ($1, $2, $3)`, [f.orgA, f.m.cara, f.u.bob])).rejects.toThrow(/row-level security|own expenses/);
    await expect(q("bob", "update public.expenses set status = 'approved' where id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(q("bob", "update public.expenses set reporting_total = 1 where id = $1", [id])).rejects.toThrow(/permission denied/);
  });

  it("is private to the owner, their supervisors and finance", async () => {
    const id = await draft("bob");
    expect(await q("cara", "select id from public.expenses where id = $1", [id])).toHaveLength(0);
    expect(await q("outsider", "select id from public.expenses where id = $1", [id])).toHaveLength(0);
    expect(await q("books", "select id from public.expenses where id = $1", [id])).toHaveLength(1);
    expect(await q("cara", "select * from public.expense_events where expense_id = $1", [id])).toHaveLength(0);
  });

  it("requires a receipt or a reason for receipt-required categories", async () => {
    const id = await draft("bob", { category_id: await cat("Meals"), merchant: "Galley Cafe", total: 18.2 });
    await expect(q("bob", "select public.submit_expense($1)", [id])).rejects.toThrow(/needs a receipt/);
    await q("bob", "update public.expenses set no_receipt_reason = 'Lost at sea' where id = $1", [id]);
    await q("bob", "select public.submit_expense($1)", [id]);
    expect((await q("bob", "select status from public.expenses where id = $1", [id]))[0].status).toBe("submitted");
  });

  it("refuses incomplete claims", async () => {
    const [{ id }] = await q("bob", "insert into public.expenses (organization_id, membership_id, created_by) values ($1, $2, $3) returning id", [f.orgA, f.m.bob, f.u.bob]);
    await expect(q("bob", "select public.submit_expense($1)", [id])).rejects.toThrow(/Fill in/);
  });
});

describe("approval workflow", () => {
  let id: string;
  beforeAll(async () => {
    id = await draft("bob", { merchant: "Chandlery Ltd", total: 120, expense_date: "2026-10-05" });
    await q("bob", "select public.submit_expense($1)", [id]);
  });

  it("locks the claim once submitted", async () => {
    const rows = await q("bob", "update public.expenses set total = 999 where id = $1 returning id", [id]);
    expect(rows).toHaveLength(0);
  });

  it("only supervisors or finance may decide, never the submitter", async () => {
    await expect(q("bob", "select public.review_expense($1, true)", [id])).rejects.toThrow(/cannot approve/);
    await expect(q("cara", "select public.review_expense($1, true)", [id])).rejects.toThrow(/cannot approve/);
    // team leader template has no expenses.approve
    await expect(q("lead", "select public.review_expense($1, true)", [id])).rejects.toThrow(/cannot approve/);
    expect((await q("books", "select public.my_expense_approval_count($1)::int n", [f.orgA]))[0].n).toBeGreaterThanOrEqual(1);
  });

  it("reviewer corrections are recorded with old and new values", async () => {
    await expect(q("books", "select public.correct_expense($1, null, null, '2026-10-05', 'Chandlery Ltd', 'GBP', null, null, 110, '')", [id])).rejects.toThrow(/Say why/);
    await q("books", "select public.correct_expense($1, $2, null, '2026-10-05', 'Chandlery Ltd', 'GBP', null, null, 110, 'Receipt shows 110')", [id, await cat("Fuel & mileage")]);
    const [ev] = await q("bob", "select changes from public.expense_events where expense_id = $1 and event = 'corrected'", [id]);
    expect(ev.changes.total).toEqual([120, 110]);
  });

  it("approval sets reporting currency; reimbursement is separate", async () => {
    await q("books", "select public.review_expense($1, true, 'ok')", [id]);
    const [row] = await q("bob", "select status, reporting_currency, fx_rate::float, reporting_total::float, reimbursement_status from public.expenses where id = $1", [id]);
    expect(row).toMatchObject({ status: "approved", reporting_currency: "GBP", fx_rate: 1, reporting_total: 110, reimbursement_status: "pending" });
    await expect(q("lead", "select public.mark_expenses_reimbursed($1, array[$2]::uuid[], 'BACS 1')", [f.orgA, id])).rejects.toThrow(/reimbursements.manage/);
    expect((await q("books", "select public.mark_expenses_reimbursed($1, array[$2]::uuid[], 'BACS 1') n", [f.orgA, id]))[0].n).toBe(1);
    expect((await q("bob", "select reimbursement_status from public.expenses where id = $1", [id]))[0].reimbursement_status).toBe("paid");
  });

  it("history is append-only", async () => {
    await expect(db.query("update public.expense_events set note = 'x' where expense_id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.expense_events where expense_id = $1", [id])).rejects.toThrow(/append-only/);
  });

  it("rejection needs a note and returns the claim for editing", async () => {
    const id2 = await draft("bob", { merchant: "Rope Store", total: 15 });
    await q("bob", "select public.submit_expense($1)", [id2]);
    await expect(q("books", "select public.review_expense($1, false)", [id2])).rejects.toThrow(/Explain/);
    await q("books", "select public.review_expense($1, false, 'Wrong project')", [id2]);
    const rows = await q("bob", "update public.expenses set description = 'Rope for deck' where id = $1 returning id", [id2]);
    expect(rows).toHaveLength(1);
  });
});

describe("currencies", () => {
  it("converts only with a bookkeeper rate and never guesses", async () => {
    const id = await draft("bob", { merchant: "Marina Antibes", currency: "EUR", total: 100, expense_date: "2026-10-10" });
    await q("bob", "select public.submit_expense($1)", [id]);
    expect((await q("bob", "select reporting_total from public.expenses where id = $1", [id]))[0].reporting_total).toBeNull();
    await expect(q("bob", "insert into public.exchange_rates (organization_id, from_currency, to_currency, rate, rate_date, source, created_by) values ($1, 'EUR', 'GBP', 0.5, '2026-10-01', 'made up', $2)", [f.orgA, f.u.bob])).rejects.toThrow(/row-level security/);
    await q("books", "insert into public.exchange_rates (organization_id, from_currency, to_currency, rate, rate_date, source, created_by) values ($1, 'EUR', 'GBP', 0.8571, '2026-10-09', 'ECB reference', $2)", [f.orgA, f.u.books]);
    await q("books", "insert into public.exchange_rates (organization_id, from_currency, to_currency, rate, rate_date, source, created_by) values ($1, 'EUR', 'GBP', 0.9, '2026-10-11', 'later rate', $2)", [f.orgA, f.u.books]);
    await q("books", "select public.review_expense($1, true)", [id]);
    const [row] = await q("bob", "select fx_rate::float, fx_date::text, fx_source, reporting_total::float from public.expenses where id = $1", [id]);
    expect(row).toEqual({ fx_rate: 0.8571, fx_date: "2026-10-09", fx_source: "ECB reference", reporting_total: 85.71 });
  });
});

describe("duplicates", () => {
  it("flags same merchant/date/total and requires explicit confirmation", async () => {
    const a = await draft("cara", { merchant: "Dock Parking", total: 8, expense_date: "2026-10-12", category_id: await cat("Parking & tolls") });
    await q("cara", "select public.submit_expense($1)", [a]);
    const b = await draft("cara", { merchant: "dock parking ", total: 8, expense_date: "2026-10-12", category_id: await cat("Parking & tolls") });
    expect(await q("cara", "select reason from public.expense_duplicates($1)", [b])).toHaveLength(1);
    await expect(q("cara", "select public.submit_expense($1)", [b])).rejects.toThrow(/DUPLICATE/);
    await q("cara", "select public.submit_expense($1, true)", [b]);
    const [row] = await q("cara", "select duplicate_of, duplicate_override from public.expenses where id = $1", [b]);
    expect(row).toEqual({ duplicate_of: a, duplicate_override: true });
  });

  it("detects the same receipt file across employees", async () => {
    const a = await draft("bob", { merchant: "Shared Taxi", total: 30, category_id: await cat("Travel") });
    const b = await draft("cara", { merchant: "Taxi", total: 30, category_id: await cat("Travel") });
    const hash = "a".repeat(64);
    for (const [exp, who] of [[a, "bob"], [b, "cara"]] as const) {
      await db.query(`insert into public.files (organization_id, storage_path, file_name, mime_type, size_bytes, sha256, context_type, context_id, uploaded_by)
        values ($1::uuid, $1::text || '/expense/' || $2::text || '/r.jpg', 'r.jpg', 'image/jpeg', 100, $3, 'expense', $2::uuid, $4)`, [f.orgA, exp, hash, f.u[who]]);
    }
    const dups = await q("cara", "select reason from public.expense_duplicates($1)", [b]);
    expect(dups.map((d) => d.reason)).toContain("Same receipt file");
    // cara can't see bob's expense or his receipt
    expect(await q("cara", "select id from public.expenses where id = $1", [a])).toHaveLength(0);
    expect(await q("cara", "select id from public.files where context_id = $1", [a])).toHaveLength(0);
    expect(await q("books", "select id from public.files where context_id = $1", [a])).toHaveLength(1);
  });
});

describe("exports", () => {
  it("only exporters can log an export", async () => {
    await expect(q("bob", "select public.log_expense_export($1, 'xlsx', '{}'::jsonb, 1)", [f.orgA])).rejects.toThrow(/expenses.export/);
    await q("books", "select public.log_expense_export($1, 'xlsx', '{}'::jsonb, 3)", [f.orgA]);
    expect(await q("books", "select id from public.expense_exports where organization_id = $1", [f.orgA])).toHaveLength(1);
    expect(await q("bob", "select id from public.expense_exports where organization_id = $1", [f.orgA])).toHaveLength(0);
  });
});

describe("attendance status privacy", () => {
  it("hides another person's clock status from colleagues", async () => {
    expect((await q("cara", "select public.attendance_state($1) s", [f.m.bob]))[0].s).toBeNull();
    expect((await q("bob", "select public.attendance_state($1) s", [f.m.bob]))[0].s).toBe("out");
  });
});
