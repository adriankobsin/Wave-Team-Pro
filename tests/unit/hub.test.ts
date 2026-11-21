import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

vi.mock("server-only", () => ({}));

const company = (id: string, name: string) => ({
  id, name, slug: id, location: "", currency: "GBP", timezone: "Europe/London",
  can: { staff: true, manageStaff: true, time: true, expenses: true, settings: true },
});
const uk = company("uk", "Acme Systems UK");
const th = company("th", "Acme Systems TH");
const row = (c: typeof uk, name: string, perDay: number[], status: "approved" | "submitted" | "none") => ({
  company: c, userId: name, name, avatarUrl: null, jobTitle: null, status, submittedAt: null, perDay, hours: perDay.reduce((a, b) => a + b, 0),
});

describe("Group Hub group timesheet exports", () => {
  const rows = [
    row(uk, "Jane", [8, 8, 8, 8, 8, 0, 0], "approved"),
    row(th, "Jane", [0, 0, 0, 0, 0, 4, 0], "submitted"),
    row(th, "Sam", [7.5, 0, 0, 0, 0, 0, 0], "none"),
  ];

  it("puts everyone on one sheet and each company on its own", async () => {
    const { hubWeekWorkbook } = await import("@/server/services/hub-export");
    const wb = new ExcelJS.Workbook();
    const buf = await hubWeekWorkbook(rows, "2026-10-26");
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["All companies", "Acme Systems TH", "Acme Systems UK"]);
    const all = wb.getWorksheet("All companies")!;
    const total = all.getRow(all.rowCount);
    expect(total.getCell(1).value).toBe("Total");
    expect(total.getCell(10).value).toBe(51.5);
    expect(wb.getWorksheet("Acme Systems TH")!.rowCount).toBe(6); // title, blank, header, 2 people, total
  });

  it("writes a PDF with a section per company", async () => {
    const { hubWeekPdf } = await import("@/server/services/hub-export");
    const doc = await PDFDocument.load(await hubWeekPdf(rows, "2026-10-26"));
    expect(doc.getPageCount()).toBe(1);
  });
});
