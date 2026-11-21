import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

async function sampleLogo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="900" height="300" fill="none"/><text x="20" y="200" font-size="160" fill="#0e2a3b">ACME</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

describe("company logo", () => {
  it("re-encodes to a PNG within 600x200 and rejects other files", async () => {
    const { processLogo, LogoError } = await import("@/lib/images/logo");
    const out = await processLogo(await sampleLogo());
    expect(out.png.subarray(1, 4).toString()).toBe("PNG");
    expect(out.width).toBeLessThanOrEqual(600);
    expect(out.height).toBeLessThanOrEqual(200);
    await expect(processLogo(new TextEncoder().encode("%PDF-1.4 not an image"))).rejects.toBeInstanceOf(LogoError);
  }, 30_000);

  it("is drawn on every PDF page and placed in Excel", async () => {
    const { processLogo } = await import("@/lib/images/logo");
    const { PdfReport } = await import("@/lib/export/pdf");
    const { addLogo } = await import("@/lib/export/excel-logo");
    const logo = await processLogo(await sampleLogo());
    const r = await PdfReport.create("footer", logo);
    r.title("Weekly timesheets");
    r.table([{ label: "A", width: 10 }], Array.from({ length: 70 }, (_, i) => [`row ${i}`]));
    const bytes = await r.bytes();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.addRow(["Title"]);
    addLogo(wb, ws, logo, 4);
    expect(ws.getImages()).toHaveLength(1);
  }, 30_000);
});
