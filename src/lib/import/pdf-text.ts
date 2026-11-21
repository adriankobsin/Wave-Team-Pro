/** A piece of text on a PDF page with its position (PDF points, y up). */
export type PdfItem = { page: number; x: number; y: number; str: string };

/** Reads every text item of a PDF with its position. Works in Node (server) — no worker needed. */
export async function pdfItems(bytes: Uint8Array): Promise<PdfItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // In Node pdf.js runs its worker in-process; load it explicitly so the deployment bundles it.
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  const out: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      out.push({ page: p, x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), str: it.str.trim() });
    }
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
