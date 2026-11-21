import { csvField } from "@/lib/export/cells";

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF). Strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => csvField(v ?? "")).join(",")).join("\r\n") + "\r\n";
}

export type DateOrder = "dmy" | "mdy" | "ymd";

/** Parses common statement date formats into YYYY-MM-DD, or null. */
export function parseStatementDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const parts = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  const named = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})$/);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (named) {
    d = Number(named[1]);
    m = months.indexOf(named[2].toLowerCase()) + 1;
    y = Number(named[3]);
  } else if (parts) {
    const [a, b, c] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (order === "mdy") [m, d, y] = [a, b, c];
    else if (order === "ymd") return null;
    else [d, m, y] = [a, b, c];
  } else return null;
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** "£1,234.56", "-12.30", "(45.00)", "12.30 DR" → signed number; null if unparseable. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR)\b/gi, "").replace(/[£$€\s,]/g, "").replace(/[A-Z]{3}/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return neg ? -n : n;
}

export type StatementLine = { date: string; description: string; amount: number; reference: string | null; currency: string | null };
export type StatementResult = { lines: StatementLine[]; skipped: { row: number; reason: string }[]; columns: Record<string, string> };

const find = (headers: string[], patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

/**
 * Reads a card statement CSV. Detects date / description / amount (or debit+credit) /
 * reference / currency columns by header name. Only spending is returned (as positive
 * amounts); refunds and payments are skipped and reported.
 */
export function parseStatement(text: string, opts: { dateOrder: DateOrder; spendSign: "negative" | "positive"; currency: string }): StatementResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], skipped: [], columns: {} };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = {
    date: find(headers, [/^(transaction |posting |trans\.? )?date$/, /date/]),
    description: find(headers, [/description|details|merchant|narrative|payee|memo|name/]),
    amount: find(headers, [/^amount$/, /amount|value/]),
    debit: find(headers, [/debit|money out|paid out|withdrawal/]),
    credit: find(headers, [/credit|money in|paid in|deposit/]),
    reference: find(headers, [/reference|ref\.?$|transaction id|id$/]),
    currency: find(headers, [/^currency$|^ccy$/]),
  };
  const columns: Record<string, string> = {};
  for (const [k, i] of Object.entries(col)) if (i >= 0) columns[k] = rows[0][i].trim();
  const lines: StatementLine[] = [];
  const skipped: StatementResult["skipped"] = [];
  if (col.date < 0 || col.description < 0 || (col.amount < 0 && col.debit < 0)) {
    return { lines, skipped: [{ row: 1, reason: "Couldn't find Date, Description and Amount (or Debit) columns" }], columns };
  }
  rows.slice(1).forEach((r, idx) => {
    const rowNo = idx + 2;
    const date = parseStatementDate(r[col.date] ?? "", opts.dateOrder);
    if (!date) return skipped.push({ row: rowNo, reason: "Unreadable date" });
    let spend: number | null = null;
    if (col.debit >= 0 && (r[col.debit] ?? "").trim()) {
      const v = parseAmount(r[col.debit]);
      spend = v === null ? null : Math.abs(v);
    } else if (col.amount >= 0 && (r[col.amount] ?? "").trim()) {
      const v = parseAmount(r[col.amount]);
      if (v !== null) spend = opts.spendSign === "negative" ? -v : v;
    } else if (col.credit >= 0 && (r[col.credit] ?? "").trim()) {
      return skipped.push({ row: rowNo, reason: "Payment or refund (credit)" });
    }
    if (spend === null) return skipped.push({ row: rowNo, reason: "Unreadable amount" });
    if (spend <= 0) return skipped.push({ row: rowNo, reason: "Payment or refund (not spending)" });
    const description = (r[col.description] ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    if (!description) return skipped.push({ row: rowNo, reason: "No description" });
    const cur = col.currency >= 0 ? (r[col.currency] ?? "").trim().toUpperCase() : "";
    lines.push({
      date,
      description,
      amount: spend,
      reference: col.reference >= 0 ? (r[col.reference] ?? "").trim().slice(0, 100) || null : null,
      currency: /^[A-Z]{3}$/.test(cur) ? cur : opts.currency,
    });
  });
  return { lines, skipped, columns };
}

/** Stable identity of a statement line so re-importing the same file adds nothing new. */
export function lineFingerprint(l: StatementLine, occurrence: number): string {
  return [l.date, l.amount.toFixed(2), l.currency, l.description.toLowerCase(), l.reference ?? "", occurrence].join("|");
}
