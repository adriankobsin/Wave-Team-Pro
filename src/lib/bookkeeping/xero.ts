import { toCsv } from "./csv";

export type AccountingLine = {
  id: string;
  employeeName: string;
  employeeEmail: string | null;
  expenseDate: string; // YYYY-MM-DD
  merchant: string;
  description: string | null;
  reference: string | null;
  currency: string;
  total: number;
  accountCode: string | null;
  taxName: string | null;
  projectLabel: string | null;
};

export type XeroOptions = {
  issueDate: string; // YYYY-MM-DD
  dueDays: number;
  prefix: string;
  trackingName: string | null;
  defaultAccountCode: string | null;
  country: string; // drives the date format Xero expects
};

/** Xero reads dates in the organisation's regional format. */
export function xeroDate(iso: string, country: string): string {
  const [y, m, d] = iso.split("-");
  return country === "US" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

function addDaysIso(iso: string, n: number) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export type ExportProblem = { id: string; problem: string };

export function lineProblems(l: AccountingLine, o: Pick<XeroOptions, "defaultAccountCode">): string[] {
  const p: string[] = [];
  if (!(l.accountCode || o.defaultAccountCode)) p.push("no account code on its category");
  if (!l.taxName) p.push("no VAT rate");
  return p;
}

const BILL_HEADERS = [
  "*ContactName", "EmailAddress", "POAddressLine1", "POAddressLine2", "POAddressLine3", "POAddressLine4", "POCity", "PORegion",
  "POPostalCode", "POCountry", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "InventoryItemCode", "*Description",
  "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "TrackingName1", "TrackingOption1", "TrackingName2", "TrackingOption2", "Currency",
];

/**
 * Xero "Bills" import: one bill per employee and currency, one line per approved claim.
 * Amounts are tax-inclusive — choose "Tax inclusive" in Xero's import step.
 */
export function xeroBillsCsv(lines: AccountingLine[], o: XeroOptions): { csv: string; bills: number } {
  const groups = new Map<string, AccountingLine[]>();
  for (const l of [...lines].sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.expenseDate.localeCompare(b.expenseDate))) {
    const k = `${l.employeeName}\u0000${l.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const stamp = o.issueDate.replace(/-/g, "");
  const rows: (string | number)[][] = [BILL_HEADERS];
  let n = 0;
  for (const list of groups.values()) {
    n++;
    const number = `${o.prefix}-${stamp}-${String(n).padStart(3, "0")}`;
    const months = [...new Set(list.map((l) => l.expenseDate.slice(0, 7)))].sort();
    const reference = `Expense claim ${months.length === 1 ? months[0] : `${months[0]} to ${months.at(-1)}`}`;
    for (const l of list) {
      const desc = [xeroDate(l.expenseDate, o.country), l.merchant, l.description, l.reference ? `Ref ${l.reference}` : null].filter(Boolean).join(" · ");
      rows.push([
        l.employeeName, l.employeeEmail ?? "", "", "", "", "", "", "", "", "",
        number, reference, xeroDate(o.issueDate, o.country), xeroDate(addDaysIso(o.issueDate, o.dueDays), o.country), "", desc.slice(0, 4000),
        1, l.total.toFixed(2), l.accountCode ?? o.defaultAccountCode ?? "", l.taxName ?? "",
        o.trackingName && l.projectLabel ? o.trackingName : "", o.trackingName && l.projectLabel ? l.projectLabel : "", "", "", l.currency,
      ]);
    }
  }
  return { csv: toCsv(rows), bills: n };
}

/**
 * Pre-coded bank statement for a company card account: spending as negative amounts, with
 * account code and tax rate so reconciliation in Xero is one click per line.
 */
export function xeroCardStatementCsv(lines: AccountingLine[], o: XeroOptions): string {
  const rows: (string | number)[][] = [["Date", "Amount", "Payee", "Description", "Reference", "Account Code", "Tax Rate", "Tracking"]];
  for (const l of [...lines].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate))) {
    rows.push([
      xeroDate(l.expenseDate, o.country),
      (-l.total).toFixed(2),
      l.merchant,
      [l.employeeName, l.description].filter(Boolean).join(" · ").slice(0, 400),
      l.reference ?? l.id.slice(0, 8),
      l.accountCode ?? o.defaultAccountCode ?? "",
      l.taxName ?? "",
      l.projectLabel ?? "",
    ]);
  }
  return toCsv(rows);
}
