import { describe, expect, it } from "vitest";
import { lineFingerprint, parseAmount, parseCsv, parseStatement, parseStatementDate } from "@/lib/bookkeeping/csv";
import { lineProblems, xeroBillsCsv, xeroCardStatementCsv, xeroDate, type AccountingLine } from "@/lib/bookkeeping/xero";
import { draftFromReading, readingWarnings, receiptExtraction, suggestTaxRate } from "@/lib/ai/receipt-schema";

const f = (value: unknown, confidence = "high") => ({ value, confidence });
const none = f(null, "unreadable");
/** Readings modelled on real receipts supplied for testing. */
const reading = (o: Record<string, unknown>) =>
  receiptExtraction.parse({
    is_receipt: true, merchant: none, date: none, reference: none, tax_number: none, currency: none, subtotal: none, discount: none,
    tax_lines: [], tip: none, total: none, payment_hint: none, language: null, line_items: [], notes: null, ...o,
  });

const rates = [
  { id: "std", name: "Standard 20%", rate: 20, reclaimable: true, active: true },
  { id: "red", name: "Reduced 5%", rate: 5, reclaimable: true, active: true },
  { id: "none", name: "No VAT / outside scope", rate: 0, reclaimable: false, active: true },
  { id: "foreign", name: "Foreign tax (not reclaimable)", rate: 0, reclaimable: false, active: true },
];
const uk = { country: "GB", currency: "GBP" };

describe("receipt readings from real-world documents", () => {
  it("Spanish restaurant (A La Fresca, IVA 10%) → foreign, not reclaimable", () => {
    const r = reading({ merchant: f("A La Fresca Denia, S.L."), date: f("2026-04-02"), currency: f("EUR"), subtotal: f(296), total: f(325.6),
      tax_lines: [{ label: "IVA", rate: 10, amount: 29.6 }], country: "ES", document_type: "pre_bill", tax_number: f("B-70830732") });
    expect(suggestTaxRate(r, rates, uk)).toBe("foreign");
    expect(draftFromReading(r)).toMatchObject({ total: 325.6, tax_amount: 29.6, currency: "EUR" });
    expect(readingWarnings(r)[0]).toMatch(/before payment/);
  });

  it("Dutch-language till in Spain (ChaCha, BTW 10%) is still foreign", () => {
    const r = reading({ merchant: f("ChaCha Denia"), currency: f("EUR"), total: f(56), tax_lines: [{ label: "BTW", rate: 10, amount: 5.09 }], country: "ES" });
    expect(suggestTaxRate(r, rates, uk)).toBe("foreign");
  });

  it("UK supplier invoice (Farnell, VAT 20%) → standard rate; card ending captured", () => {
    const r = reading({ merchant: f("Premier Farnell UK Ltd"), currency: f("GBP"), total: f(250.67), tax_lines: [{ label: "VAT", rate: 20, amount: 41.78 }], country: "GB", document_type: "invoice", card_last4: "1025" });
    expect(suggestTaxRate(r, rates, uk)).toBe("std");
    expect(r.card_last4).toBe("1025");
    expect(readingWarnings(r)).toEqual([]);
  });

  it("UK receipt without printed VAT rate is left for a person", () => {
    const r = reading({ merchant: f("Apollo Private Hire"), currency: f("GBP"), total: f(128.1), country: "GB" });
    expect(suggestTaxRate(r, rates, uk)).toBeNull();
  });

  it("business-rates letter (Goodman Nash) is flagged and fills nothing", () => {
    const r = reading({ is_receipt: false, document_type: "other", merchant: f("Goodman Nash") });
    expect(readingWarnings(r)[0]).toMatch(/doesn't look like a receipt/);
    expect(draftFromReading(r)).toEqual({});
  });

  it("card terminal slip (IberCaja 9,80 €) is flagged as slip only", () => {
    const r = reading({ merchant: f("Fuego Pilota N 1"), total: f(9.8), currency: f("EUR"), document_type: "card_slip", card_last4: "4511", country: "ES" });
    expect(readingWarnings(r)[0]).toMatch(/card payment slip/);
  });

  it("one PDF with two receipts (ChaCha 74.50 + Fuego 25.50) offers a split", () => {
    const r = reading({ merchant: f("ChaCha Denia"), total: f(74.5), currency: f("EUR"), date: f("2026-04-03"), country: "ES",
      other_receipts: [{ merchant: "Fuego Centro", date: "2026-04-03", currency: "EUR", total: 25.5 }] });
    expect(r.other_receipts).toHaveLength(1);
    expect(readingWarnings(r).join(" ")).toMatch(/contains 2 receipts/);
  });

  it("older stored readings without the new fields still parse", () => {
    const r = reading({});
    expect(r.document_type).toBe("receipt");
    expect(r.other_receipts).toEqual([]);
  });
});

describe("statement CSV", () => {
  it("parses quotes, BOM and CRLF", () => {
    expect(parseCsv('﻿a,"b, c","d ""q"""\r\n1,2,3\r\n')).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
  });
  it("parses dates and amounts in bank formats", () => {
    expect(parseStatementDate("04/04/2026", "dmy")).toBe("2026-04-04");
    expect(parseStatementDate("04/13/2026", "mdy")).toBe("2026-04-13");
    expect(parseStatementDate("2026-04-04", "dmy")).toBe("2026-04-04");
    expect(parseStatementDate("4 Apr 2026", "dmy")).toBe("2026-04-04");
    expect(parseStatementDate("31/02/2026", "dmy")).toBeNull();
    expect(parseAmount("£1,234.56")).toBe(1234.56);
    expect(parseAmount("-9.80")).toBe(-9.8);
    expect(parseAmount("(45.00)")).toBe(-45);
    expect(parseAmount("12.30 DR")).toBe(-12.3);
    expect(parseAmount("abc")).toBeNull();
  });
  it("keeps spending only, from signed or debit/credit layouts", () => {
    const signed = parseStatement("Date,Description,Amount,Currency\n04/04/2026,FUEGO PILOTA DENIA,-9.80,EUR\n05/04/2026,PAYMENT THANK YOU,500.00,GBP\n", { dateOrder: "dmy", spendSign: "negative", currency: "GBP" });
    expect(signed.lines).toEqual([{ date: "2026-04-04", description: "FUEGO PILOTA DENIA", amount: 9.8, reference: null, currency: "EUR" }]);
    expect(signed.skipped).toHaveLength(1);
    const dc = parseStatement("Transaction Date,Details,Money Out,Money In\n01/04/2026,FARNELL,250.67,\n02/04/2026,REFUND,,10.00\n", { dateOrder: "dmy", spendSign: "negative", currency: "GBP" });
    expect(dc.lines.map((l) => [l.description, l.amount, l.currency])).toEqual([["FARNELL", 250.67, "GBP"]]);
    expect(parseStatement("foo,bar\n1,2\n", { dateOrder: "dmy", spendSign: "negative", currency: "GBP" }).skipped[0].reason).toMatch(/Couldn't find/);
  });
  it("fingerprints are stable and separate identical lines", () => {
    const l = { date: "2026-04-04", description: "Taxi", amount: 10, reference: null, currency: "GBP" };
    expect(lineFingerprint(l, 0)).toBe(lineFingerprint({ ...l }, 0));
    expect(lineFingerprint(l, 0)).not.toBe(lineFingerprint(l, 1));
  });
});

describe("Xero files", () => {
  const line = (o: Partial<AccountingLine>): AccountingLine => ({
    id: "e1", employeeName: "John Doe", employeeEmail: "a@example.test", expenseDate: "2026-04-03", merchant: "ChaCha Denia",
    description: "Client dinner", reference: null, currency: "EUR", total: 74.5, accountCode: "420", taxName: "No VAT", projectLabel: "P-001 Refit", ...o,
  });
  const opts = { issueDate: "2026-04-30", dueDays: 7, prefix: "EXP", trackingName: "Project", defaultAccountCode: null, country: "GB" };

  it("formats dates for the organisation's region", () => {
    expect(xeroDate("2026-04-03", "GB")).toBe("03/04/2026");
    expect(xeroDate("2026-04-03", "US")).toBe("04/03/2026");
  });

  it("builds one bill per person and currency", () => {
    const { csv, bills } = xeroBillsCsv([line({}), line({ id: "e2", currency: "GBP", total: 12, merchant: "Parking" }), line({ id: "e3", total: 25.5, merchant: "Fuego" })], opts);
    expect(bills).toBe(2);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toMatch(/^\*ContactName,EmailAddress,/);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain("EXP-20260430-");
    expect(rows[1]).toContain("30/04/2026,07/05/2026");
    expect(rows[1]).toContain(",420,No VAT,Project,P-001 Refit,,,EUR");
  });

  it("card statement uses negative amounts and keeps text safe", () => {
    const csv = xeroCardStatementCsv([line({ merchant: "=HYPERLINK(evil)" })], opts);
    expect(csv.split("\r\n")[1]).toMatch(/^03\/04\/2026,-74\.50,'=HYPERLINK/);
  });

  it("reports what needs coding before export", () => {
    expect(lineProblems(line({ accountCode: null, taxName: null }), { defaultAccountCode: null })).toEqual(["no account code on its category", "no VAT rate"]);
    expect(lineProblems(line({ accountCode: null }), { defaultAccountCode: "429" })).toEqual([]);
  });
});

describe("Asia-Pacific companies", () => {
  const sg = [
    { id: "gst9", name: "GST standard 9%", rate: 9, reclaimable: true, active: true },
    { id: "nogst", name: "Not GST-registered supplier", rate: 0, reclaimable: false, active: true },
    { id: "foreign", name: "Foreign tax (not reclaimable)", rate: 0, reclaimable: false, active: true },
  ];
  it("Singapore airport receipt with 9% GST maps to standard GST for a Singapore company", () => {
    const r = reading({ merchant: f("Dairy Queen Changi"), currency: f("SGD"), total: f(15.9), tax_lines: [{ label: "GST", rate: 9, amount: 1.31 }], country: "SG" });
    expect(suggestTaxRate(r, sg, { country: "SG", currency: "SGD" })).toBe("gst9");
    expect(suggestTaxRate(r, rates, uk)).toBe("foreign");
  });
  it("Cambodian company paying in USD: USD is home currency, 10% VAT matches", () => {
    const kh = [{ id: "vat10", name: "VAT 10%", rate: 10, reclaimable: true, active: true }, ...sg.slice(2)];
    const r = reading({ currency: f("USD"), total: f(110), tax_lines: [{ label: "VAT", rate: 10, amount: 10 }], country: "KH" });
    expect(suggestTaxRate(r, kh, { country: "KH", currency: "USD" })).toBe("vat10");
  });
});
