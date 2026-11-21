import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PDFDocument, degrees } from "pdf-lib";
vi.mock("server-only", () => ({}));
const { PdfReport } = await import("@/lib/export/pdf");

describe("project pack PDF", () => {
  it("has a cover, a filled contents page, tables, rack drawings, appended drawings and page numbers on every page", async () => {
    const png = await sharp({ create: { width: 320, height: 200, channels: 4, background: { r: 14, g: 42, b: 59, alpha: 1 } } }).png().toBuffer();
    const pdf = await PdfReport.create("Acme Systems SG · MY Seabreeze · Project pack", { png }, { numbersAtEnd: true, noFirstPage: true });
    pdf.cover({ company: "Acme Systems SG", kind: "Project pack", title: "MY Seabreeze", subtitle: "ALB-01 · Singapore", details: [["Project manager", "John Doe"], ["Status", "Active"]], generated: "2026-11-08 13:30" });
    const contents = pdf.reserveContents();
    const a = pdf.pageBreak();
    pdf.title("Cable & patch panel schedule", "695 cables");
    pdf.table([{ label: "Deck", width: 10 }, { label: "Cable no.", width: 30 }], Array.from({ length: 80 }, (_, i) => ["LD", `NET ${1000 + i}`]));
    const b = pdf.pageBreak();
    pdf.title("Rack elevations");
    pdf.racks([{ name: "552-R2 - NETWORK RACK", units: 42, items: [{ u_bottom: 1, u_size: 3, kind: "ups", label: "APC UPS" }, { u_bottom: 40, u_size: 1, kind: "patch_panel", label: "FIBRE PATCH PANEL" }] }, { name: "251-R1", units: 12, items: [{ u_bottom: 6, u_size: 1, kind: "switch", label: "CISCO C9300L-48PF-4X-E" }] }]);
    const drawing = await PDFDocument.create();
    drawing.addPage([3370, 2384]).setRotation(degrees(90));
    const c = await pdf.appendPdf(await drawing.save());
    pdf.fillContents(contents, [{ title: "Cables", page: a }, { title: "Racks", page: b }, { title: "Drawings", page: c }, { title: "GA", page: c, sub: true }]);
    const out = await pdf.bytes();
    if (process.env.OUT) (await import("node:fs")).writeFileSync(process.env.OUT, out);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(c);
    expect(a).toBe(3);
    expect(doc.getPage(c - 1).getRotation().angle).toBe(90);
  });
});
