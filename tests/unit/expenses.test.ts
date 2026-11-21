import { describe, expect, it } from "vitest";
import { checkReceipt, draftFromReading, receiptExtraction } from "@/lib/ai/receipt-schema";
import { csvField, receiptEntryName, safeText, totalsByCurrency } from "@/lib/export/cells";

const f = (value: unknown, confidence = "high") => ({ value, confidence });
const sample = {
  is_receipt: true,
  merchant: f("Harbour Fuel"),
  date: f("2026-10-01"),
  reference: f("INV-77"),
  tax_number: f(null, "unreadable"),
  currency: f("gbp"),
  subtotal: f(35.42),
  discount: f(null, "unreadable"),
  tax_lines: [{ label: "VAT", rate: 20, amount: 7.08 }],
  tip: f(null, "unreadable"),
  total: f(42.5),
  payment_hint: f("card"),
  language: "en",
  line_items: [{ description: "Diesel", quantity: 1, amount: 42.5 }],
  notes: null,
};

describe("receipt reading schema", () => {
  it("accepts a valid reading and normalises currency", () => {
    const r = receiptExtraction.parse(sample);
    expect(r.currency.value).toBe("GBP");
  });

  it("drops values the model marked unreadable", () => {
    const r = receiptExtraction.parse({ ...sample, total: f(99, "unreadable") });
    expect(r.total.value).toBeNull();
  });

  it("rejects invalid shapes, negative amounts and bad dates", () => {
    expect(receiptExtraction.safeParse({ ...sample, total: f(-5) }).success).toBe(false);
    expect(receiptExtraction.safeParse({ ...sample, date: f("01/10/2026") }).success).toBe(false);
    expect(receiptExtraction.safeParse({ ...sample, merchant: "x" }).success).toBe(false);
  });

  it("maps only readable fields into the draft and never invents values", () => {
    const d = draftFromReading(receiptExtraction.parse(sample));
    expect(d).toEqual({ merchant: "Harbour Fuel", expense_date: "2026-10-01", reference: "INV-77", currency: "GBP", subtotal: 35.42, tax_amount: 7.08, total: 42.5 });
    expect(draftFromReading(receiptExtraction.parse({ ...sample, is_receipt: false }))).toEqual({});
  });

  it("flags totals that don't add up and future dates", () => {
    const ok = receiptExtraction.parse(sample);
    expect(checkReceipt(ok, "2026-10-21")).toEqual([]);
    const bad = receiptExtraction.parse({ ...sample, total: f(50), date: f("2026-12-01") });
    expect(checkReceipt(bad, "2026-10-21").map((x) => x.field).sort()).toEqual(["date", "total"]);
    // VAT-inclusive subtotal is accepted
    const incl = receiptExtraction.parse({ ...sample, subtotal: f(42.5) });
    expect(checkReceipt(incl, "2026-10-21")).toEqual([]);
  });
});

describe("export cells", () => {
  it("neutralises formula injection", () => {
    for (const s of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\t=x", "|calc"]) expect(safeText(s).startsWith("'")).toBe(true);
    expect(safeText("Harbour Fuel")).toBe("Harbour Fuel");
    expect(safeText(null)).toBe("");
    expect(csvField('a "quote", here')).toBe('"a ""quote"", here"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(12.5)).toBe("12.5");
  });

  it("builds stable receipt file names", () => {
    expect(receiptEntryName("1234abcd-0000", 0, "IMG 001.JPG")).toBe("receipts/1234abcd-1.jpg");
    expect(receiptEntryName("1234abcd-0000", 2, "../../evil.p$f")).toBe("receipts/1234abcd-3.pf");
  });

  it("never sums different currencies together", () => {
    const t = totalsByCurrency([{ c: "GBP", a: 10.1 }, { c: "EUR", a: 5 }, { c: "GBP", a: 0.2 }, { c: null, a: 3 }], (r) => r.c, (r) => r.a);
    expect(Object.fromEntries(t)).toEqual({ GBP: 10.3, EUR: 5 });
  });
});
