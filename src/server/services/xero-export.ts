import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listPeople } from "@/server/services/people";
import type { ExpenseRow } from "@/server/services/expenses";
import { lineProblems, xeroBillsCsv, xeroCardStatementCsv, type AccountingLine } from "@/lib/bookkeeping/xero";

export type XeroOrg = { id: string; country: string };

/**
 * Turns approved claims into Xero lines plus the options used to write the CSV. Shared by the
 * download route and SharePoint filing so both produce the same file.
 */
export async function prepareXero(supabase: SupabaseClient, org: XeroOrg, rows: ExpenseRow[], issueDate: string, client?: SupabaseClient) {
  const [people, { data: categories }, { data: rates }, { data: projects }, { data: settings }] = await Promise.all([
    listPeople(org.id, { includeInactive: true, showEmail: true }, client),
    supabase.from("expense_categories").select("id, accounting_code").eq("organization_id", org.id),
    supabase.from("tax_rates").select("id, accounting_name").eq("organization_id", org.id),
    supabase.from("projects").select("id, name, code").eq("organization_id", org.id),
    supabase.from("accounting_settings").select("*").eq("organization_id", org.id).maybeSingle(),
  ]);
  const person = new Map(people.map((p) => [p.membershipId, p]));
  const code = new Map((categories ?? []).map((c) => [c.id, c.accounting_code as string | null]));
  const taxName = new Map((rates ?? []).map((t) => [t.id, t.accounting_name as string]));
  const proj = new Map((projects ?? []).map((p) => [p.id, p.code ? `${p.code} ${p.name}` : p.name]));
  const opts = {
    issueDate,
    dueDays: settings?.bill_due_days ?? 0,
    prefix: settings?.bill_prefix ?? "EXP",
    trackingName: settings?.tracking_name ?? null,
    defaultAccountCode: settings?.default_account_code ?? null,
    country: org.country,
  };
  const lines: AccountingLine[] = rows
    .filter((r) => r.total !== null && r.currency && r.expense_date)
    .map((r) => ({
      id: r.id,
      employeeName: person.get(r.membership_id)?.name ?? "Former colleague",
      employeeEmail: person.get(r.membership_id)?.email ?? null,
      expenseDate: r.expense_date!,
      merchant: r.merchant ?? "",
      description: r.description,
      reference: r.reference,
      currency: r.currency!,
      total: r.total!,
      accountCode: (r.category_id ? code.get(r.category_id) : null) ?? null,
      taxName: r.tax_rate_id ? taxName.get(r.tax_rate_id) ?? null : null,
      projectLabel: r.project_id ? proj.get(r.project_id) ?? null : null,
    }));
  return { lines, opts, problems: lines.map((l) => ({ l, p: lineProblems(l, opts) })).filter((x) => x.p.length) };
}

export function xeroCsv(kind: "bills" | "card", lines: AccountingLine[], opts: Awaited<ReturnType<typeof prepareXero>>["opts"]) {
  return kind === "card" ? xeroCardStatementCsv(lines, opts) : xeroBillsCsv(lines, opts).csv;
}
