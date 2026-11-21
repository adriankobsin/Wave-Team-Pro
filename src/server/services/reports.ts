import "server-only";
import ExcelJS from "exceljs";
import { safeText } from "@/lib/export/cells";
import { addLogo } from "@/lib/export/excel-logo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { listExpenses } from "@/server/services/expenses";
import { addDays, addMonths } from "@/lib/time";
import { BRAND } from "@/lib/brand";

export type Range = { from: string; to: string }; // inclusive YYYY-MM-DD

export function monthRange(fromMonth: string, toMonth: string): Range {
  const [a, b] = fromMonth <= toMonth ? [fromMonth, toMonth] : [toMonth, fromMonth];
  return { from: `${a}-01`, to: addDays(addMonths(`${b}-01`, 1), -1) };
}

type Line = { label: string; hours: number; overtime: number };
type Money = { label: string; currency: string; total: number; count: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Aggregates approved hours, approved expenses and approved leave in a date range, limited by RLS. */
export async function buildReport(orgId: string, range: Range, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  const [people, { data: projects }, { data: categories }, { data: sheets }, { data: leave }, { data: types }] = await Promise.all([
    listPeople(orgId, { includeInactive: true }, client),
    supabase.from("projects").select("id, name, code, budget_hours").eq("organization_id", orgId),
    supabase.from("expense_categories").select("id, name").eq("organization_id", orgId),
    supabase.from("timesheets").select("id, membership_id").eq("organization_id", orgId).eq("status", "approved")
      .gte("week_start", addDays(range.from, -6)).lte("week_start", range.to),
    supabase.from("leave_requests").select("membership_id, leave_type_id, start_date, end_date, days").eq("organization_id", orgId).eq("status", "approved")
      .lte("start_date", range.to).gte("end_date", range.from),
    supabase.from("leave_types").select("id, name, paid").eq("organization_id", orgId),
  ]);
  const name = new Map(people.map((p) => [p.membershipId, p.name]));
  const project = new Map((projects ?? []).map((p) => [p.id, p]));
  const category = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const sheetOwner = new Map((sheets ?? []).map((s) => [s.id, s.membership_id]));

  // Hours
  const entries: { timesheet_id: string; project_id: string | null; hours: number; is_overtime: boolean; work_date: string }[] = [];
  const ids = [...sheetOwner.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("timesheet_entries").select("timesheet_id, project_id, hours, is_overtime, work_date")
      .in("timesheet_id", ids.slice(i, i + 200)).gte("work_date", range.from).lte("work_date", range.to);
    entries.push(...((data ?? []) as typeof entries));
  }
  const addLine = (m: Map<string, Line>, label: string, h: number, ot: boolean) => {
    const l = m.get(label) ?? { label, hours: 0, overtime: 0 };
    l.hours = r2(l.hours + h);
    if (ot) l.overtime = r2(l.overtime + h);
    m.set(label, l);
  };
  const byProject = new Map<string, Line>();
  const byPerson = new Map<string, Line>();
  for (const e of entries) {
    const h = Number(e.hours);
    addLine(byProject, e.project_id ? project.get(e.project_id)?.name ?? "Unknown project" : "No project", h, e.is_overtime);
    addLine(byPerson, name.get(sheetOwner.get(e.timesheet_id)!) ?? "Former colleague", h, e.is_overtime);
  }
  const hoursTotal = r2(entries.reduce((n, e) => n + Number(e.hours), 0));

  // Expenses (approved, by receipt date) — grouped per currency, never mixed
  const expenses = (await listExpenses(orgId, { status: "approved", from: range.from, to: range.to }, client)).filter((e) => e.expense_date && e.expense_date >= range.from && e.expense_date <= range.to);
  const group = (key: (e: (typeof expenses)[number]) => string) => {
    const m = new Map<string, Money>();
    for (const e of expenses) {
      if (!e.currency || e.total === null) continue;
      const k = `${key(e)}\u0000${e.currency}`;
      const g = m.get(k) ?? { label: key(e), currency: e.currency, total: 0, count: 0 };
      g.total = r2(g.total + e.total);
      g.count++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label) || a.currency.localeCompare(b.currency));
  };
  const expByCategory = group((e) => (e.category_id ? category.get(e.category_id) : null) ?? "Uncategorised");
  const expByPerson = group((e) => name.get(e.membership_id) ?? "Former colleague");
  const expByProject = group((e) => (e.project_id ? project.get(e.project_id)?.name : null) ?? "No project");
  const expByCurrency = group(() => "All");
  const converted = expenses.filter((e) => e.reporting_total !== null);
  const reporting = {
    currency: converted[0]?.reporting_currency ?? null,
    total: r2(converted.reduce((n, e) => n + (e.reporting_total ?? 0), 0)),
    count: converted.length,
    unconverted: expenses.length - converted.length,
  };
  const reimbursementDue = group((e) => (e.reimbursement_status === "pending" ? "Due" : "")).filter((g) => g.label === "Due");

  // Leave days that fall inside the range (pro-rated by calendar overlap for long requests)
  const typeName = new Map((types ?? []).map((t) => [t.id, t.name]));
  const leaveByType = new Map<string, number>();
  const leaveByPerson = new Map<string, number>();
  for (const l of leave ?? []) {
    const span = (Date.parse(l.end_date) - Date.parse(l.start_date)) / 86_400_000 + 1;
    const from = l.start_date < range.from ? range.from : l.start_date;
    const to = l.end_date > range.to ? range.to : l.end_date;
    const inside = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    const days = r2((Number(l.days) * inside) / span);
    const t = typeName.get(l.leave_type_id) ?? "Leave";
    leaveByType.set(t, r2((leaveByType.get(t) ?? 0) + days));
    const p = name.get(l.membership_id) ?? "Former colleague";
    leaveByPerson.set(p, r2((leaveByPerson.get(p) ?? 0) + days));
  }

  const sortLines = (m: Map<string, Line>) => [...m.values()].sort((a, b) => b.hours - a.hours);
  return {
    range,
    hours: { total: hoursTotal, byProject: sortLines(byProject), byPerson: sortLines(byPerson), overtime: r2(entries.filter((e) => e.is_overtime).reduce((n, e) => n + Number(e.hours), 0)) },
    expenses: { count: expenses.length, byCurrency: expByCurrency, byCategory: expByCategory, byPerson: expByPerson, byProject: expByProject, reporting, reimbursementDue },
    leave: { byType: [...leaveByType.entries()].map(([label, days]) => ({ label, days })), byPerson: [...leaveByPerson.entries()].map(([label, days]) => ({ label, days })).sort((a, b) => b.days - a.days) },
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;

/** Excel workbook of a report: hours, expenses (per currency) and leave. */
export async function reportWorkbook(orgName: string, r: Report, title?: string, logo?: { png: Buffer; width: number; height: number } | null): Promise<Buffer> {
  const ctx = { org: { name: orgName } };
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const money = "#,##0.00";
  const sheet = (name: string, headers: string[], rows: (string | number)[][], moneyCol?: number) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${safeText(ctx.org.name)} — ${name}, ${r.range.from} to ${r.range.to}`]).font = { bold: true };
    ws.addRow(headers).font = { bold: true };
    for (const row of rows) ws.addRow(row.map((v) => (typeof v === "string" ? safeText(v) : v)));
    ws.columns.forEach((c, i) => {
      c.width = i === 0 ? 32 : 14;
      if (moneyCol !== undefined && i === moneyCol) c.numFmt = money;
    });
  };
  sheet("Hours by project", ["Project", "Hours", "Overtime"], r.hours.byProject.map((l) => [l.label, l.hours, l.overtime]));
  sheet("Hours by person", ["Person", "Hours", "Overtime"], r.hours.byPerson.map((l) => [l.label, l.hours, l.overtime]));
  sheet("Expenses by category", ["Category", "Currency", "Total", "Claims"], r.expenses.byCategory.map((g) => [g.label, g.currency, g.total, g.count]), 2);
  sheet("Expenses by person", ["Person", "Currency", "Total", "Claims"], r.expenses.byPerson.map((g) => [g.label, g.currency, g.total, g.count]), 2);
  sheet("Expenses by project", ["Project", "Currency", "Total", "Claims"], r.expenses.byProject.map((g) => [g.label, g.currency, g.total, g.count]), 2);
  sheet("Leave", ["Leave type", "Working days"], r.leave.byType.map((l) => [l.label, l.days]));
  if (title) wb.title = title;
  for (const ws of wb.worksheets) addLogo(wb, ws, logo, 4);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
