/**
 * Neutralises spreadsheet formula injection: text that a spreadsheet would treat as a
 * formula or DDE command gets a leading apostrophe so it is shown as text.
 */
export function safeText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return /^[=+\-@\t\r|%]/.test(s) ? `'${s}` : s;
}

/** CSV field with quoting and formula protection. */
export function csvField(value: string | number | null | undefined): string {
  if (typeof value === "number") return String(value);
  // Plain signed numbers (e.g. "-74.50") are data, not formulas.
  if (value && /^-?\d+(\.\d+)?$/.test(value)) return value;
  const s = safeText(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Stable, filesystem-safe receipt name inside the ZIP. */
export function receiptEntryName(expenseId: string, index: number, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  return `receipts/${expenseId.slice(0, 8)}-${index + 1}.${ext}`;
}

export type CurrencyTotals = Map<string, number>;

/** Sums amounts per currency; never adds different currencies together. */
export function totalsByCurrency<T>(rows: T[], currency: (r: T) => string | null, amount: (r: T) => number | null): CurrencyTotals {
  const out: CurrencyTotals = new Map();
  for (const r of rows) {
    const c = currency(r);
    const a = amount(r);
    if (!c || a === null || Number.isNaN(a)) continue;
    out.set(c, Math.round(((out.get(c) ?? 0) + a) * 100) / 100);
  }
  return out;
}
