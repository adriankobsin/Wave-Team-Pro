import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", books: "bookkeeper", boss: "director", bob: "employee" });
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const queued = async (kind: string) => (await db.query("select ref_key, ref from public.sharepoint_uploads where organization_id = $1 and kind = $2 order by created_at", [f.orgA, kind])).rows;

let n = 0;
async function approvedClaimWithReceipt() {
  n++;
  const cat = (await db.query("select id from public.expense_categories where organization_id = $1 limit 1", [f.orgA])).rows[0].id;
  const [{ id }] = await q("bob", `insert into public.expenses (organization_id, membership_id, merchant, expense_date, currency, total, description, payment_method, category_id, created_by)
    values ($1, $2, 'Farnell', $5, 'GBP', $6, 'Cables', 'personal', $4, $3) returning id`, [f.orgA, f.m.bob, f.u.bob, cat, `2026-05-0${n}`, 70 + n]);
  await db.query(`insert into public.files (organization_id, storage_path, file_name, mime_type, size_bytes, sha256, context_type, context_id, uploaded_by)
    values ($1::uuid, $1::text || '/r/' || gen_random_uuid() || '.pdf', 'farnell.pdf', 'application/pdf', 10, $2, 'expense', $3, $4)`, [f.orgA, (n % 10).toString().repeat(64), id, f.u.bob]);
  await q("bob", "select public.submit_expense($1)", [id]);
  await q("books", "select public.review_expense($1, true)", [id]);
  return id as string;
}

describe("SharePoint filing queue", () => {
  it("does nothing while filing is off", async () => {
    await approvedClaimWithReceipt();
    expect(await queued("receipt")).toHaveLength(0);
  });

  it("only admins can switch it on; employees can't see settings or the log", async () => {
    await expect(q("bob", "insert into public.sharepoint_settings (organization_id, enabled, site_url) values ($1, true, 'https://x.sharepoint.com/sites/F')", [f.orgA])).rejects.toThrow(/row-level security/);
    await q("admin", "insert into public.sharepoint_settings (organization_id, enabled, site_url) values ($1, true, 'https://acme.sharepoint.com/sites/Finance')", [f.orgA]);
    await expect(q("admin", "insert into public.sharepoint_settings (organization_id, site_url) values ($1, 'https://evil.example.com')", [f.orgB])).rejects.toThrow();
    expect(await q("bob", "select * from public.sharepoint_settings")).toHaveLength(0);
    // Microsoft ids are server-only
    await expect(q("admin", "update public.sharepoint_settings set drive_id = 'x' where organization_id = $1", [f.orgA])).rejects.toThrow(/permission denied/);
  });

  it("queues every receipt of an approved expense", async () => {
    const id = await approvedClaimWithReceipt();
    const rows = await queued("receipt");
    expect(rows).toHaveLength(1);
    expect(rows[0].ref.expense_id).toBe(id);
  });

  it("queues approved timesheets, closed months and Xero exports", async () => {
    const [{ id: ts }] = await q("bob", "select public.ensure_timesheet($1, '2026-05-11') id", [f.orgA]);
    await db.query("insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-05-11', 8)", [f.orgA, ts]);
    await q("bob", "select public.submit_timesheet($1)", [ts]);
    await q("admin", "select public.review_timesheet($1, true, null)", [ts]);
    expect((await queued("employee_timesheet"))[0].ref.timesheet_id).toBe(ts);

    await q("books", "select public.set_period_closed($1, '2026-05-01', true)", [f.orgA]);
    await q("books", "select public.set_period_closed($1, '2026-05-01', false)", [f.orgA]);
    await q("books", "select public.set_period_closed($1, '2026-05-01', true)", [f.orgA]);
    expect(await queued("expense_month")).toHaveLength(2); // closed twice → filed twice (new version)

    const e = (await db.query("select id from public.expenses where organization_id = $1 and status = 'approved' limit 1", [f.orgA])).rows[0].id;
    const [{ x }] = await q("books", "select public.mark_accounting_export($1, 'xero_bills', array[$2]::uuid[], '{}'::jsonb) x", [f.orgA, e]);
    expect((await queued("xero_bills"))[0].ref.export_id).toBe(x);
  });

  it("respects switched-off kinds and is idempotent", async () => {
    await q("admin", "update public.sharepoint_settings set disabled_kinds = array['weekly_report'] where organization_id = $1", [f.orgA]);
    await as(db, { role: "service_role" }, async (c) => {
      await c("select public.sharepoint_enqueue($1, 'weekly_report', '2026-05-11', '{}'::jsonb)", [f.orgA]);
      await c("select public.sharepoint_enqueue($1, 'weekly_timesheets', '2026-05-11', '{}'::jsonb)", [f.orgA]);
      await c("select public.sharepoint_enqueue($1, 'weekly_timesheets', '2026-05-11', '{}'::jsonb)", [f.orgA]);
    });
    expect(await queued("weekly_report")).toHaveLength(0);
    expect(await queued("weekly_timesheets")).toHaveLength(1);
    await expect(q("admin", "select public.sharepoint_enqueue($1, 'weekly_report', 'x', '{}'::jsonb)", [f.orgA])).rejects.toThrow(/permission denied/);
  });

  it("finance and admins see the log and can retry failures; others can't", async () => {
    const id = (await db.query("update public.sharepoint_uploads set status = 'failed', last_error = 'boom' where organization_id = $1 and kind = 'weekly_timesheets' returning id", [f.orgA])).rows[0].id;
    expect((await q("books", "select count(*)::int n from public.sharepoint_uploads"))[0].n).toBeGreaterThan(0);
    expect(await q("bob", "select id from public.sharepoint_uploads")).toHaveLength(0);
    await expect(q("bob", "select public.sharepoint_retry($1)", [id])).rejects.toThrow(/Not allowed/);
    await expect(q("books", "update public.sharepoint_uploads set status = 'done' where id = $1", [id])).rejects.toThrow(/permission denied/);
    await q("books", "select public.sharepoint_retry($1)", [id]);
    expect((await db.query("select status, last_error from public.sharepoint_uploads where id = $1", [id])).rows[0]).toEqual({ status: "pending", last_error: null });
  });
});

describe("company logo storage", () => {
  it("members read the logo; nobody writes it directly", async () => {
    await db.query("insert into public.organization_branding (organization_id, logo_png_base64, logo_width, logo_height) values ($1, 'aGk=', 10, 10) on conflict (organization_id) do nothing", [f.orgA]);
    expect(await q("bob", "select logo_width from public.organization_branding where organization_id = $1", [f.orgA])).toHaveLength(1);
    expect(await q("outsider", "select logo_width from public.organization_branding where organization_id = $1", [f.orgA])).toHaveLength(0);
    await expect(q("admin", "update public.organization_branding set logo_width = 1 where organization_id = $1", [f.orgA])).rejects.toThrow(/permission denied/);
  });
});
