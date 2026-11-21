import "server-only";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DirectoryPerson } from "@/server/services/people";
import type { ExpenseRow } from "@/server/services/expenses";
import { receiptEntryName, safeText, totalsByCurrency } from "@/lib/export/cells";
import { addLogo } from "@/lib/export/excel-logo";
import { BRAND } from "@/lib/brand";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Returned", cancelled: "Withdrawn" };
const PAY_LABEL: Record<string, string> = { personal: "Employee (personal card)", company_card: "Company card", cash: "Employee (cash)", other: "Other" };
const REIMB_LABEL: Record<string, string> = { not_required: "Not required", pending: "Due", paid: "Paid" };

export type ExpenseWorkbookInput = {
  supabase: SupabaseClient;
  org: { name: string; slug: string; base_currency: string };
  rows: ExpenseRow[];
  people: DirectoryPerson[];
  projects: { id: string; name: string; code: string | null; cost_center: string | null }[];
  categories: { id: string; name: string; accounting_code: string | null }[];
  filters: Record<string, string | null>;
  generatedBy: string;
  appBaseUrl: string;
  /** "zip": receipt columns list the file names used inside the zip. */
  format: "xlsx" | "zip";
  logo?: { png: Buffer; width: number; height: number } | null;
};

/** The expense workbook (Expenses, Summary, Line items) used by downloads and SharePoint filing. */
export async function buildExpenseWorkbook(input: ExpenseWorkbookInput): Promise<{ xlsx: Buffer; zipNames: Map<string, string[]> }> {
  const { supabase, rows, people, filters, format } = input;
  const ctx = { org: input.org, profile: { display_name: input.generatedBy } };
  const base = input.appBaseUrl;
  const byMembership = new Map(people.map((p) => [p.membershipId, p]));
  const byUser = new Map(people.map((p) => [p.userId, p]));
  const project = new Map(input.projects.map((p) => [p.id, p]));
  const category = new Map(input.categories.map((c) => [c.id, c]));

  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  wb.created = new Date();
  const money = "#,##0.00";
  const dateFmt = "yyyy-mm-dd";

  // --- Expenses: one row per expense
  const ws = wb.addWorksheet("Expenses", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Expense ID", key: "id", width: 38 },
    { header: "Employee", key: "employee", width: 24 },
    { header: "Employee ID", key: "employee_id", width: 38 },
    { header: "Organization", key: "org", width: 20 },
    { header: "Project", key: "project", width: 24 },
    { header: "Project code", key: "project_code", width: 12 },
    { header: "Cost centre", key: "cost_center", width: 12 },
    { header: "Receipt date", key: "expense_date", width: 12, style: { numFmt: dateFmt } },
    { header: "Submitted", key: "submitted", width: 12, style: { numFmt: dateFmt } },
    { header: "Merchant", key: "merchant", width: 24 },
    { header: "Invoice / reference", key: "reference", width: 16 },
    { header: "Tax number", key: "tax_number", width: 16 },
    { header: "Business purpose", key: "description", width: 36 },
    { header: "Category", key: "category", width: 18 },
    { header: "Account code", key: "account", width: 12 },
    { header: "Currency", key: "currency", width: 9 },
    { header: "Subtotal", key: "subtotal", width: 12, style: { numFmt: money } },
    { header: "Tax", key: "tax", width: 10, style: { numFmt: money } },
    { header: "Tip", key: "tip", width: 10, style: { numFmt: money } },
    { header: "Total", key: "total", width: 12, style: { numFmt: money } },
    { header: "Reporting currency", key: "rep_currency", width: 10 },
    { header: "FX rate", key: "fx_rate", width: 12, style: { numFmt: "0.000000" } },
    { header: "FX date", key: "fx_date", width: 12, style: { numFmt: dateFmt } },
    { header: "FX source", key: "fx_source", width: 18 },
    { header: "Converted total", key: "rep_total", width: 14, style: { numFmt: money } },
    { header: "Paid by", key: "payment", width: 22 },
    { header: "Reimbursement amount", key: "reimb_amount", width: 14, style: { numFmt: money } },
    { header: "Reimbursement status", key: "reimb_status", width: 12 },
    { header: "Reimbursement ref", key: "reimb_ref", width: 16 },
    { header: "Approval status", key: "status", width: 12 },
    { header: "Reviewer", key: "reviewer", width: 20 },
    { header: "Reviewed", key: "reviewed", width: 12, style: { numFmt: dateFmt } },
    { header: "Duplicate flag", key: "duplicate", width: 12 },
    { header: "Receipt files", key: "files", width: 30 },
    { header: "Receipt link", key: "link", width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  const d = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : null);
  const zipNames = new Map<string, string[]>();
  for (const r of rows) {
    const p = r.project_id ? project.get(r.project_id) : null;
    const c = r.category_id ? category.get(r.category_id) : null;
    const who = byMembership.get(r.membership_id);
    const names = r.receipts.map((f, i) => receiptEntryName(r.id, i, f.file_name));
    zipNames.set(r.id, names);
    ws.addRow({
      id: r.id,
      employee: safeText(who?.name ?? "Former colleague"),
      employee_id: r.membership_id,
      org: safeText(ctx.org.name),
      project: safeText(p?.name),
      project_code: safeText(p?.code),
      cost_center: safeText(p?.cost_center),
      expense_date: d(r.expense_date),
      submitted: d(r.submitted_at),
      merchant: safeText(r.merchant),
      reference: safeText(r.reference),
      tax_number: safeText(r.tax_number),
      description: safeText(r.description),
      category: safeText(c?.name),
      account: safeText(c?.accounting_code),
      currency: r.currency ?? "",
      subtotal: r.subtotal,
      tax: r.tax_amount,
      tip: r.tip_amount,
      total: r.total,
      rep_currency: r.reporting_currency ?? "",
      fx_rate: r.fx_rate,
      fx_date: d(r.fx_date),
      fx_source: safeText(r.fx_source),
      rep_total: r.reporting_total,
      payment: PAY_LABEL[r.payment_method] ?? r.payment_method,
      reimb_amount: r.reimbursement_status === "not_required" ? null : r.total,
      reimb_status: REIMB_LABEL[r.reimbursement_status],
      reimb_ref: safeText(r.reimbursement_reference),
      status: STATUS_LABEL[r.status],
      reviewer: safeText(r.reviewed_by ? byUser.get(r.reviewed_by)?.name : ""),
      reviewed: d(r.reviewed_at),
      duplicate: r.duplicate_override ? "Confirmed repeat" : "",
      files: format === "zip" ? names.join(", ") : safeText(r.receipts.map((f) => f.file_name).join(", ")),
      link: r.receipts.length ? { text: "Open", hyperlink: `${base}/o/${ctx.org.slug}/expenses/${r.id}` } : r.no_receipt_reason ? safeText(`No receipt: ${r.no_receipt_reason}`) : "",
    });
  }

  // --- Summary: totals per currency (never mixed), plus converted totals where a rate exists
  const sum = wb.addWorksheet("Summary");
  sum.getColumn(1).width = 30;
  sum.getColumn(2).width = 12;
  sum.getColumn(3).width = 16;
  sum.getColumn(4).width = 10;
  sum.addRow([`${ctx.org.name} — expense export`]).font = { bold: true, size: 13 };
  sum.addRow([`Filters: ${describe(filters)}`]);
  sum.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by ${safeText(ctx.profile.display_name)}`]);
  sum.addRow([`Rows: ${rows.length}. Amounts in different currencies are never added together.`]);
  sum.addRow([]);
  const section = (title: string, groups: Map<string, ExpenseRow[]>) => {
    sum.addRow([title, "Currency", "Total", "Count"]).font = { bold: true };
    for (const [label, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const [cur, total] of totalsByCurrency(list, (r) => r.currency, (r) => r.total)) {
        const row = sum.addRow([safeText(label), cur, total, list.filter((r) => r.currency === cur).length]);
        row.getCell(3).numFmt = money;
      }
    }
    sum.addRow([]);
  };
  const group = (key: (r: ExpenseRow) => string) => {
    const m = new Map<string, ExpenseRow[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  section("All expenses", group(() => "All"));
  const repCur = ctx.org.base_currency;
  const converted = rows.filter((r) => r.reporting_total !== null);
  sum.addRow([`Converted to ${repCur}`, repCur, converted.reduce((n, r) => Math.round((n + (r.reporting_total ?? 0)) * 100) / 100, 0), converted.length]).getCell(3).numFmt = money;
  if (rows.length - converted.length) sum.addRow([`Not converted (no exchange rate)`, "", "", rows.length - converted.length]);
  sum.addRow([]);
  section("By category", group((r) => (r.category_id ? category.get(r.category_id)?.name : null) ?? "Uncategorised"));
  section("By employee", group((r) => byMembership.get(r.membership_id)?.name ?? "Former colleague"));
  section("By project", group((r) => (r.project_id ? project.get(r.project_id)?.name : null) ?? "No project"));
  section("By month", group((r) => r.expense_date?.slice(0, 7) ?? "No date"));

  // --- Line items read from receipts (where available)
  const { data: readings } = rows.length
    ? await supabase.from("expense_ai_extractions").select("expense_id, result").in("expense_id", rows.map((r) => r.id).slice(0, 1000)).eq("status", "done")
    : { data: [] as { expense_id: string; result: unknown }[] };
  const items = wb.addWorksheet("Line items");
  items.columns = [
    { header: "Expense ID", key: "id", width: 38 },
    { header: "Merchant", key: "merchant", width: 24 },
    { header: "Description", key: "desc", width: 40 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Amount", key: "amount", width: 12, style: { numFmt: money } },
    { header: "Currency", key: "cur", width: 9 },
  ];
  items.getRow(1).font = { bold: true };
  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const rd of readings ?? []) {
    const r = rowById.get(rd.expense_id);
    const list = ((rd.result as { line_items?: { description: string; quantity: number | null; amount: number | null }[] } | null)?.line_items ?? []).slice(0, 60);
    for (const li of list) items.addRow({ id: rd.expense_id, merchant: safeText(r?.merchant), desc: safeText(li.description), qty: li.quantity, amount: li.amount, cur: r?.currency ?? "" });
  }

  addLogo(wb, sum, input.logo, 5);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  return { xlsx, zipNames };
}

function describe(f: Record<string, string | null>) {
  const parts = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(", ") : "none";
}
