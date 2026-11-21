import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { pdfSafe } from "@/lib/export/pdf";

export type Label = { kind: string; title: string; detail?: string; project: string; url: string };

const MM = 72 / 25.4;
/** Standard A4 sticker sheets (sizes in mm). */
export const LABEL_SHEETS = {
  small: { name: "Small, 21 per A4 sheet (63.5 × 38.1 mm, e.g. Avery L7160)", cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, gapX: 2.5, gapY: 0 },
  large: { name: "Large, 8 per A4 sheet (99.1 × 67.7 mm, e.g. Avery L7165) for rack doors and panels", cols: 2, rows: 4, w: 99.1, h: 67.7, top: 13.1, left: 4.65, gapX: 2.5, gapY: 0 },
} as const;
export type LabelSheet = keyof typeof LABEL_SHEETS;

const INK = rgb(0.055, 0.165, 0.231);
const MUTED = rgb(0.36, 0.42, 0.45);

/** Draws a QR code as vector squares (sharp at any print size), top-left at (x, top). */
export function drawQr(page: PDFPage, text: string, x: number, top: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2; // modules of white border inside `size`
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y: top - size, width: size, height: size, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run++;
      page.drawRectangle({ x: x + (quiet + c) * cell, y: top - (quiet + r + 1) * cell, width: run * cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
      c += run;
    }
  }
}

function fit(font: PDFFont, t: string, size: number, width: number) {
  let s = pdfSafe(t);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s}...`;
}

/** Splits a title over up to two lines, shrinking it if needed. */
function titleLines(font: PDFFont, t: string, max: number, width: number) {
  const s = pdfSafe(t);
  for (let size = max; size >= max * 0.6; size -= 0.5) if (font.widthOfTextAtSize(s, size) <= width) return { size, lines: [s] };
  const size = max * 0.75;
  const words = s.split(/(?<=[\s\\/_-])/);
  let a = "";
  for (const w of words) { if (font.widthOfTextAtSize(a + w, size) > width && a) break; a += w; }
  return { size, lines: [a.trimEnd(), fit(font, s.slice(a.length).trimStart(), size, width)] };
}

/**
 * A4 sheet(s) of QR stickers: each with the QR code, what it is (rack, patch panel…), its name,
 * a detail line, the project and the company logo. Scanning opens the live page in the app.
 */
export async function labelsPdf(labels: Label[], sheet: LabelSheet, logo?: { png: Buffer } | null): Promise<Uint8Array> {
  const L = LABEL_SHEETS[sheet];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let img: PDFImage | null = null;
  if (logo) { try { img = await doc.embedPng(logo.png); } catch { img = null; } }
  const per = L.cols * L.rows;
  const w = L.w * MM, h = L.h * MM, pad = (sheet === "small" ? 2.5 : 4) * MM;

  labels.forEach((label, i) => {
    if (i % per === 0) doc.addPage([595.28, 841.89]);
    const page = doc.getPages()[doc.getPageCount() - 1];
    const k = i % per, col = k % L.cols, row = Math.floor(k / L.cols);
    const x = (L.left + col * (L.w + L.gapX)) * MM;
    const top = 841.89 - (L.top + row * (L.h + L.gapY)) * MM;
    const qr = sheet === "small" ? h - 2 * pad : Math.min(h - 2 * pad, w * 0.45);
    drawQr(page, label.url, x + pad, top - (h - qr) / 2, qr);
    const tx = x + pad + qr + pad * 0.8, tw = w - (tx - x) - pad;
    let y = top - pad;
    if (img) {
      const s = Math.min(tw / img.width, (sheet === "small" ? 7 : 11) * MM / img.height);
      page.drawImage(img, { x: tx, y: y - img.height * s, width: img.width * s, height: img.height * s });
      y -= img.height * s + (sheet === "small" ? 2 : 4);
    }
    const kindSize = sheet === "small" ? 6 : 8;
    page.drawText(fit(bold, label.kind.toUpperCase(), kindSize, tw), { x: tx, y: y - kindSize, size: kindSize, font: bold, color: MUTED });
    y -= kindSize + 3;
    const t = titleLines(bold, label.title, sheet === "small" ? 11 : 17, tw);
    for (const line of t.lines) { page.drawText(line, { x: tx, y: y - t.size, size: t.size, font: bold, color: INK }); y -= t.size + 1.5; }
    const small = sheet === "small" ? 6 : 8;
    if (label.detail) { page.drawText(fit(font, label.detail, small, tw), { x: tx, y: y - small - 1, size: small, font, color: INK }); y -= small + 3; }
    page.drawText(fit(font, label.project, small, tw), { x: tx, y: top - h + pad + small + 2, size: small, font, color: MUTED });
    page.drawText(fit(font, "Scan for the live schedule", small * 0.9, tw), { x: tx, y: top - h + pad, size: small * 0.9, font, color: MUTED });
  });
  if (!labels.length) doc.addPage([595.28, 841.89]);
  return doc.save();
}
