import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { displayToPdf, stampDrawing } from "@/lib/drawings/stamp";

/** A sheet with an offset crop box and the given /Rotate, like real CAD exports. */
async function sheet(rotation: number) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1200, 800]);
  page.setCropBox(50, 30, 1000, 700);
  page.setRotation(degrees(rotation));
  return { doc, page, bytes: await doc.save() };
}

describe("drawing export", () => {
  it.each([0, 90, 180, 270])("puts a marker where the viewer showed it (rotation %i°)", async (rotation) => {
    const { bytes } = await sheet(rotation);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const g = globalThis as { pdfjsWorker?: unknown };
    g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const view = (await doc.getPage(1)).getViewport({ scale: 1 }); // exactly what the in-app viewer uses
    const page = (await PDFDocument.load(bytes)).getPage(0);
    for (const [u, v] of [[0.1, 0.2], [0.75, 0.6], [0.5, 0.95]]) {
      const p = displayToPdf(page, u, v);
      const [px, py] = view.convertToViewportPoint(p.x, p.y);
      expect(px / view.width).toBeCloseTo(u, 6);
      expect(py / view.height).toBeCloseTo(v, 6);
    }
  }, 30_000);

  it("stamps markers and a legend without breaking the file", async () => {
    const { bytes } = await sheet(90);
    const out = await stampDrawing(bytes, [
      { page: 1, x: 0.3, y: 0.4, short: "AP", label: "AP 1 — Owner's cabin", color: "#0284c7", layer: "Access points" },
      { page: 1, x: 0.6, y: 0.4, short: "SUB", label: "SUB 1", color: "#166534", layer: "Speakers" },
    ], [{ name: "Access points", color: "#0284c7", count: 1 }, { name: "Speakers", color: "#166534", count: 1 }], "MY Seabreeze · GA");
    const again = await PDFDocument.load(out);
    expect(again.getPageCount()).toBe(1);
    expect(again.getPage(0).getRotation().angle).toBe(90);
    expect(out.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("lists every device in the legend; a long list continues on legend pages", async () => {
    const { bytes } = await sheet(0);
    const few = await stampDrawing(bytes, [
      { page: 1, x: 0.3, y: 0.4, short: "K", label: "K 1", color: "#b07d2b", layer: "Keypads", kind: "Keypad", detail: "HAIRDRESSER 112 / ENTRANCE · Lutron HQWT-U-P4W" },
    ], [{ name: "Keypads", color: "#b07d2b", count: 1 }], "MY Seabreeze · MAIN DECK");
    expect((await PDFDocument.load(few)).getPageCount()).toBe(1);
    const many = Array.from({ length: 300 }, (_, i) => ({ page: 1, x: (i % 30) / 30, y: Math.floor(i / 30) / 12, short: "AP", label: `AP ${i + 1}`, color: "#0284c7", layer: "WIFI", kind: "Access point", detail: `Cabin ${i}` }));
    const doc = await PDFDocument.load(await stampDrawing(bytes, many, [{ name: "WIFI", color: "#0284c7", count: 300 }], "MY Seabreeze · TANK DECK"));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getPage(1).getSize()).toEqual({ width: 1190.55, height: 841.89 });
    const keyOnly = await PDFDocument.load(await stampDrawing(bytes, many, [{ name: "WIFI", color: "#0284c7", count: 300 }], "x", { legend: "key" }));
    expect(keyOnly.getPageCount()).toBe(1);
  });

  it("draws cable runs in their system colour and lists them in the legend", async () => {
    const { bytes } = await sheet(90);
    const out = await stampDrawing(bytes, [
      { page: 1, x: 0.2, y: 0.3, short: "K", label: "K 1", color: "#b07d2b", layer: "Keypads", kind: "Keypad" },
      { page: 1, x: 0.6, y: 0.3, short: "K", label: "K 2", color: "#b07d2b", layer: "Keypads", kind: "Keypad" },
    ], [{ name: "Keypads", color: "#b07d2b", count: 2 }], "MY Seabreeze · GA", {
      cables: [{ page: 1, points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }], color: "#b07d2b", layer: "Keypads", label: "QS link 1", detail: "Lutron QS · K 1 > K 2" }],
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(out.byteLength).toBeGreaterThan(bytes.byteLength);
    // Cables alone (no devices yet) still get stamped.
    const onlyCables = await stampDrawing(bytes, [], [], "x", { cables: [{ page: 1, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }], color: "#0284c7", layer: "Access points" }] });
    expect(onlyCables.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it.each([0, 90, 180, 270])("adds the legend beside the drawing instead of over it (rotation %i°)", async (rotation) => {
    const { bytes } = await sheet(rotation);
    const before = (await PDFDocument.load(bytes)).getPage(0).getCropBox();
    const out = await stampDrawing(bytes, [{ page: 1, x: 0.9, y: 0.9, short: "K", label: "K 1", color: "#b07d2b", layer: "Keypads", kind: "Keypad" }], [{ name: "Keypads", color: "#b07d2b", count: 1 }], "x");
    const after = (await PDFDocument.load(out)).getPage(0).getCropBox();
    // The original sheet is still entirely inside the (bigger) page.
    expect(after.x).toBeLessThanOrEqual(before.x + 1e-6);
    expect(after.y).toBeLessThanOrEqual(before.y + 1e-6);
    expect(after.x + after.width).toBeGreaterThanOrEqual(before.x + before.width - 1e-6);
    expect(after.y + after.height).toBeGreaterThanOrEqual(before.y + before.height - 1e-6);
    expect(after.width * after.height).toBeGreaterThan(before.width * before.height * 1.2);
  });

  it.each([0, 90])("puts the company logo in the legend panel and on legend pages (rotation %i°)", async (rotation) => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 15, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
    const { bytes } = await sheet(rotation);
    const many = Array.from({ length: 300 }, (_, i) => ({ page: 1, x: (i % 30) / 30, y: Math.floor(i / 30) / 12, short: "AP", label: `AP ${i + 1}`, color: "#0284c7", layer: "WIFI", kind: "Access point", detail: `Cabin ${i}` }));
    const out = await stampDrawing(bytes, many, [{ name: "WIFI", color: "#0284c7", count: 300 }], "MY Seabreeze · TANK DECK", { logo: { png } });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBeGreaterThan(1); // legend pages, each with the logo too
    const without = await stampDrawing(bytes, many, [{ name: "WIFI", color: "#0284c7", count: 300 }], "MY Seabreeze · TANK DECK");
    expect(out.byteLength).toBeGreaterThan(without.byteLength);
    // A broken image never breaks the export.
    await expect(stampDrawing(bytes, many.slice(0, 2), [], "x", { logo: { png: Buffer.from("not a png") } })).resolves.toBeInstanceOf(Uint8Array);
  });
});
