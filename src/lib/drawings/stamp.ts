import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

/** `kind` is the device type ("Access point"); `detail` the linked device / notes shown in the legend. */
/** `box`: a control box, panel or rack — drawn as a square instead of a dot. */
export type StampMarker = { page: number; x: number; y: number; short: string; label: string; color: string; layer: string; kind?: string; detail?: string; box?: boolean };
export type StampLayer = { name: string; color: string; count: number };
/** A cable run: points as display fractions; `detail` is its type, route and rack for the legend. */
export type StampCable = { page: number; points: { x: number; y: number }[]; color: string; layer: string; label?: string; detail?: string };

const hex = (c: string) => {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
// Standard PDF fonts only cover Latin-1; replace anything else so a label never breaks the export.
const safe = (s: string) => s.replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

/**
 * Maps a point given as fractions of the page *as displayed* (0,0 top-left; what the viewer and the
 * markers use) to PDF user space, honouring the page's crop box and /Rotate.
 */
export function displayToPdf(page: Pick<PDFPage, "getCropBox" | "getRotation">, u: number, v: number) {
  const { x: x0, y: y0, width: w, height: h } = page.getCropBox();
  const rot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  switch (rot) {
    case 90: return { x: x0 + v * w, y: y0 + u * h, rot };
    case 180: return { x: x0 + (1 - u) * w, y: y0 + v * h, rot };
    case 270: return { x: x0 + (1 - v) * w, y: y0 + (1 - u) * h, rot };
    default: return { x: x0 + u * w, y: y0 + (1 - v) * h, rot: 0 as const };
  }
}

/** Size of the page as displayed (rotation swaps width and height). */
function displaySize(page: PDFPage) {
  const { width, height } = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? { w: height, h: width } : { w: width, h: height };
}

/**
 * Makes the displayed sheet bigger on its right or bottom edge by `extra` (display units), leaving the
 * drawing exactly where it is, so the legend can sit next to it instead of on top of it. Works on
 * rotated sheets: the extension is computed in display space and mapped back to the page's boxes.
 */
export function extendSheet(page: PDFPage, side: "right" | "bottom", extra: number) {
  const { w, h } = displaySize(page);
  const u1 = side === "right" ? 1 + extra / w : 1, v1 = side === "bottom" ? 1 + extra / h : 1;
  const pts = [[0, 0], [u1, 0], [0, v1], [u1, v1]].map(([u, v]) => displayToPdf(page, u, v));
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  const m = page.getMediaBox();
  const mx0 = Math.min(m.x, x0), my0 = Math.min(m.y, y0), mx1 = Math.max(m.x + m.width, x1), my1 = Math.max(m.y + m.height, y1);
  page.setMediaBox(mx0, my0, mx1 - mx0, my1 - my0);
  for (const set of [page.setCropBox, page.setTrimBox, page.setBleedBox, page.setArtBox]) set.call(page, x0, y0, x1 - x0, y1 - y0);
}

/** Where the legend panel goes: below a long, wide sheet (like a yacht GA), otherwise to its right. */
export function legendPanel(w: number, h: number): { side: "right" | "bottom"; extra: number } {
  if (w / h >= 1.6) return { side: "bottom", extra: Math.max(h * 0.45, w * 0.14) };
  return { side: "right", extra: Math.max(w * 0.34, h * 0.3) };
}

/** Text that reads left-to-right on the displayed page, starting at display point (u, v) as its baseline. */
function text(page: PDFPage, font: PDFFont, s: string, u: number, v: number, size: number, color = rgb(0, 0, 0)) {
  const p = displayToPdf(page, u, v);
  page.drawText(safe(s), { x: p.x, y: p.y, size, font, color, rotate: degrees(p.rot) });
}

/** A rectangle given in display fractions (axis-aligned in both spaces because rotations are multiples of 90°). */
function rect(page: PDFPage, u0: number, v0: number, u1: number, v1: number, opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; opacity?: number }) {
  const a = displayToPdf(page, u0, v0), b = displayToPdf(page, u1, v1);
  page.drawRectangle({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
    color: opts.fill, borderColor: opts.border, borderWidth: opts.border ? 0.6 : 0, opacity: opts.opacity, borderOpacity: 1,
  });
}

type Font = PDFFont;
type Entry = { short: string; color: string; label: string; kind: string; detail: string; layer: string; page: number; line?: boolean; box?: boolean };
type KeyRow = { short: string; color: string; kind: string; n: number; line?: boolean; box?: boolean };

/** "K 2" before "K 10"; grouped by device type in the app's order. */
const KIND_ORDER = ["Rack", "Lighting panel", "Shade control box", "Keypad", "Touch panel", "Access point", "Speaker", "Subwoofer", "TV / display", "Camera", "Sensor", "Data point", "Intercom", "Phone", "Light", "Other"];
function sortEntries(list: Entry[]) {
  const rank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  return [...list].sort((a, b) => Number(Boolean(a.line)) - Number(Boolean(b.line)) || rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }) || a.page - b.page);
}
function keyRows(list: Entry[]): KeyRow[] {
  const m = new Map<string, KeyRow>();
  for (const e of list) { const k = `${e.line ? "line" : "dot"}|${e.kind}|${e.short}|${e.color}`; const r = m.get(k) ?? { short: e.short, color: e.color, kind: e.kind, n: 0, line: e.line, box: e.box }; r.n++; m.set(k, r); }
  return [...m.values()]; // `list` is already sorted, so the key follows the same order
}
function fit(font: Font, s: string, size: number, width: number) {
  let t = safe(s);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}
/** A dot, or for control boxes / panels / racks a square, centred on (cx, cy) in PDF space. */
function symbol(page: PDFPage, cx: number, cy: number, r: number, color: string, box: boolean | undefined, border: number) {
  if (box) {
    const s = r * 1.1; // a square a little bigger than the dot, so it reads as a box
    page.drawRectangle({ x: cx - s, y: cy - s, width: s * 2, height: s * 2, color: hex(color), borderColor: rgb(1, 1, 1), borderWidth: border });
  } else page.drawCircle({ x: cx, y: cy, size: r, color: hex(color), borderColor: rgb(1, 1, 1), borderWidth: border });
}

function badge(page: PDFPage, bold: Font, cx: number, cy: number, r: number, short: string, color: string, box?: boolean) {
  symbol(page, cx, cy, r, color, box, r * 0.15);
  const tag = safe(short).slice(0, 3);
  const ts = r * (tag.length > 2 ? 0.62 : tag.length > 1 ? 0.8 : 1);
  page.drawText(tag, { x: cx - bold.widthOfTextAtSize(tag, ts) / 2, y: cy - ts * 0.35, size: ts, font: bold, color: rgb(1, 1, 1) });
}

/**
 * The legend box drawn on a sheet, in display coordinates converted per point. Tries to fit the
 * whole device list (in columns, shrinking the text down to a readable minimum); returns false when
 * it doesn't fit, so the caller draws only the symbol key and lists the devices on extra pages.
 */
function sheetLegend(page: PDFPage, fonts: { bold: Font; regular: Font }, title: string, entries: Entry[], keys: KeyRow[], layersLine: string, full: boolean, overflowNote: string | null, area: { x: number; y: number; w: number; h: number }, sheetMax: number) {
  const { w, h } = displaySize(page);
  const { bold, regular } = fonts;
  const base = Math.max(sheetMax / 230, 7);
  const minFs = Math.max(6, sheetMax / 480); // never smaller than 6 pt printed
  const maxW = area.w, maxH = area.h;
  const keyCols = (fs: number) => Math.max(1, Math.floor((Math.min(maxW, fs * 70)) / (fs * 17)));
  const lineText = (e: Entry) => [e.label, e.kind, e.detail].filter(Boolean).join("  -  ");

  type Plan = { fs: number; cols: number; rowsPer: number; colW: number; boxW: number; boxH: number; keyRowsN: number; listed: boolean };
  let plan: Plan | null = null;
  for (let fs = base; fs >= minFs - 0.01; fs *= 0.9) {
    const lineH = fs * 1.55, pad = fs * 1.1;
    const kc = keyCols(fs);
    const keyRowsN = Math.ceil(keys.length / kc);
    const head = fs * 1.25 * 1.6 + lineH * (layersLine ? 1 : 0) + lineH * (keyRowsN + 1) + (overflowNote && !full ? lineH : 0);
    const keyW = Math.min(kc, keys.length) * fs * 17;
    if (!full || !entries.length) {
      const boxW = Math.max(keyW, bold.widthOfTextAtSize(safe(title), fs * 1.25), regular.widthOfTextAtSize(safe(overflowNote ?? ""), fs)) + pad * 2;
      if (head + pad * 2 > maxH) continue;
      plan = { fs, cols: 0, rowsPer: 0, colW: 0, boxW: Math.min(boxW, maxW), boxH: head + pad * 2, keyRowsN, listed: false };
      break;
    }
    const rowsPer = Math.floor((maxH - head - pad * 2 - lineH) / lineH);
    if (rowsPer < 3) continue;
    const cols = Math.ceil(entries.length / rowsPer);
    const longest = Math.max(...entries.map((e) => regular.widthOfTextAtSize(safe(lineText(e)), fs))) + fs * 2.2;
    const avail = (maxW - pad * 2 - (cols - 1) * fs * 1.5) / cols;
    if (avail < Math.min(longest, fs * 28)) continue; // too narrow to read: smaller text, or the legend pages
    const colW = Math.min(longest, avail);
    const boxW = Math.min(maxW, Math.max(cols * colW + (cols - 1) * fs * 1.5, keyW, bold.widthOfTextAtSize(safe(title), fs * 1.25)) + pad * 2);
    const rows = Math.min(entries.length, rowsPer);
    plan = { fs, cols, rowsPer, colW, boxW, boxH: head + lineH * (rows + 1) + pad * 2, keyRowsN, listed: true };
    break;
  }
  if (!plan) return false;

  const { fs } = plan;
  const lineH = fs * 1.55, pad = fs * 1.1;
  // Display-space helpers: x from the left, y from the top of the displayed sheet. The legend sits at
  // the top-left of its own panel beside the drawing.
  const X0 = area.x, Y0 = area.y;
  const put = (x: number, y: number, s: string, size: number, font: Font, color = rgb(0.08, 0.1, 0.12)) => text(page, font, s, x / w, y / h, size, color);
  const dot = (x: number, y: number, r: number, short: string, color: string, line?: boolean, box?: boolean) => {
    if (line) {
      const a = displayToPdf(page, (x - r * 1.1) / w, y / h), b = displayToPdf(page, (x + r * 1.1) / w, y / h);
      page.drawLine({ start: a, end: b, thickness: r * 0.55, color: hex(color) });
      return;
    }
    const c = displayToPdf(page, x / w, y / h);
    symbol(page, c.x, c.y, r, color, box, r * 0.15);
    const tag = safe(short).slice(0, 3);
    const ts = r * (tag.length > 2 ? 0.62 : tag.length > 1 ? 0.8 : 1);
    text(page, bold, tag, (x - bold.widthOfTextAtSize(tag, ts) / 2) / w, (y + ts * 0.35) / h, ts, rgb(1, 1, 1));
  };

  rect(page, X0 / w, Y0 / h, (X0 + plan.boxW) / w, (Y0 + plan.boxH) / h, { fill: rgb(1, 1, 1), border: rgb(0.2, 0.2, 0.2), opacity: 0.95 });

  let y = Y0 + pad + fs * 1.25;
  put(X0 + pad, y, fit(bold, title, fs * 1.25, plan.boxW - pad * 2), fs * 1.25, bold);
  y += fs * 1.25 * 0.6 + lineH;
  if (layersLine) { put(X0 + pad, y, fit(regular, layersLine, fs, plan.boxW - pad * 2), fs, regular, rgb(0.35, 0.38, 0.42)); y += lineH; }
  const nDev = entries.filter((e) => !e.line).length, nCab = entries.length - nDev;
  put(X0 + pad, y, `LEGEND  -  ${nDev} device${nDev === 1 ? "" : "s"}${nCab ? `, ${nCab} cable${nCab === 1 ? "" : "s"}` : ""} on this sheet`, fs * 0.9, bold, rgb(0.35, 0.38, 0.42));
  y += lineH;
  const kc = keyCols(fs);
  keys.forEach((k, i) => {
    const cx = X0 + pad + (i % kc) * fs * 17, cy = y + Math.floor(i / kc) * lineH;
    dot(cx + fs * 0.75, cy - fs * 0.35, fs * 0.72, k.short, k.color, k.line, k.box);
    put(cx + fs * 1.9, cy, fit(regular, `${k.kind}  x ${k.n}`, fs, fs * 14.5), fs, regular);
  });
  y += plan.keyRowsN * lineH;
  if (!plan.listed) {
    if (overflowNote) put(X0 + pad, y + lineH * 0.3, fit(bold, overflowNote, fs, plan.boxW - pad * 2), fs, bold);
    return true;
  }
  // Separator, then the device list in columns.
  rect(page, (X0 + pad) / w, (y - lineH * 0.55) / h, (X0 + plan.boxW - pad) / w, (y - lineH * 0.55 + Math.max(0.4, fs * 0.05)) / h, { fill: rgb(0.75, 0.75, 0.75) });
  y += lineH * 0.25;
  entries.forEach((e, i) => {
    const col = Math.floor(i / plan.rowsPer), row = i % plan.rowsPer;
    const cx = X0 + pad + col * (plan.colW + fs * 1.5), cy = y + row * lineH;
    dot(cx + fs * 0.75, cy - fs * 0.35, fs * 0.72, e.short, e.color, e.line, e.box);
    const lab = safe(e.label);
    const lw = Math.min(bold.widthOfTextAtSize(lab, fs), plan.colW * 0.45);
    put(cx + fs * 1.9, cy, fit(bold, lab, fs, plan.colW * 0.45), fs, bold);
    const rest = [e.kind, e.detail].filter(Boolean).join("  -  ");
    if (rest) put(cx + fs * 1.9 + lw + fs * 0.6, cy, fit(regular, rest, fs, plan.colW - fs * 2.5 - lw - fs * 0.6), fs, regular, rgb(0.25, 0.28, 0.32));
  });
  return true;
}

/** Extra A3 landscape pages listing every device, used when the list doesn't fit on the sheet. */
function legendPages(doc: PDFDocument, fonts: { bold: Font; regular: Font }, title: string, entries: Entry[], multiPage: boolean, logo: PDFImage | null) {
  const W = 1190.55, H = 841.89, M = 40, fs = 8.5, lineH = 13.5;
  const cols: [string, number][] = multiPage
    ? [["", 18], ["Tag / label", 150], ["Type", 90], ["Linked device / details", 580], ["Layer", 200], ["Sheet page", 60]]
    : [["", 18], ["Tag / label", 160], ["Type", 100], ["Linked device / details", 620], ["Layer", 210]];
  let page: PDFPage | null = null; let y = 0; let n = 0;
  const start = () => {
    page = doc.addPage([W, H]); n++;
    if (logo) {
      const sc = Math.min(150 / logo.width, 36 / logo.height);
      page.drawImage(logo, { x: W - M - logo.width * sc, y: H - M - logo.height * sc + 10, width: logo.width * sc, height: logo.height * sc });
    }
    page.drawText(fit(fonts.bold, `${title}  -  device legend${n > 1 ? ` (continued)` : ""}`, 13, W - 2 * M - (logo ? 170 : 0)), { x: M, y: H - M, size: 13, font: fonts.bold, color: rgb(0.08, 0.1, 0.12) });
    page.drawText(`${entries.length} items`, { x: M, y: H - M - 16, size: fs, font: fonts.regular, color: rgb(0.35, 0.38, 0.42) });
    y = H - M - 38; let x = M;
    for (const [h, cw] of cols) { page.drawText(h, { x, y, size: fs, font: fonts.bold, color: rgb(0.35, 0.38, 0.42) }); x += cw; }
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    y -= lineH + 2;
  };
  start();
  for (const e of entries) {
    if (y < M) start();
    const p = page as unknown as PDFPage;
    if (e.line) p.drawLine({ start: { x: M, y: y + fs * 0.35 }, end: { x: M + 12, y: y + fs * 0.35 }, thickness: 3, color: hex(e.color) });
    else badge(p, fonts.bold, M + 6, y + fs * 0.35, 6, e.short, e.color, e.box);
    const vals = multiPage ? [e.label, e.kind, e.detail, e.layer, String(e.page)] : [e.label, e.kind, e.detail, e.layer];
    let x = M + cols[0][1];
    vals.forEach((v, i) => {
      const cw = cols[i + 1][1];
      p.drawText(fit(i === 0 ? fonts.bold : fonts.regular, v ?? "", fs, cw - 8), { x, y, size: fs, font: i === 0 ? fonts.bold : fonts.regular, color: rgb(0.1, 0.12, 0.14) });
      x += cw;
    });
    y -= lineH;
  }
}

/**
 * Returns a copy of the drawing with each marker drawn as a coloured dot with its tag (AP, K, SP…)
 * and label, and on every page with markers a legend: the symbols used with how many of each, then
 * every device on that sheet (label, type, linked device, room, IP, notes). When the list doesn't
 * fit on the sheet, the sheet keeps the symbol key and the full list follows on legend pages.
 * `legend: "key"` draws only the symbol key.
 */
export async function stampDrawing(pdf: Uint8Array, markers: StampMarker[], layers: StampLayer[], title: string, opts: { legend?: "full" | "key"; cables?: StampCable[]; logo?: { png: Uint8Array | Buffer } | null } = {}): Promise<Uint8Array> {
  const cables = opts.cables ?? [];
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  let logo: PDFImage | null = null;
  if (opts.logo) { try { logo = await doc.embedPng(opts.logo.png); } catch { logo = null; } }
  const pages = doc.getPages();
  const used = new Set([...markers.map((m) => m.page), ...cables.map((c) => c.page)]);
  const full = opts.legend !== "key";
  const toEntry = (m: StampMarker): Entry => ({ short: m.short, color: m.color, label: m.label, kind: m.kind ?? m.layer, detail: m.detail ?? "", layer: m.layer, page: m.page, box: m.box });
  const overflow: Entry[] = [];
  const layersLine = layers.filter((l) => l.count > 0).map((l) => `${l.name} (${l.count})`).join(", ");

  pages.forEach((page, i) => {
    const n = i + 1;
    if (!used.has(n) && !(n === 1 && !used.size)) return;
    const sheet = displaySize(page);
    const sheetMax = Math.max(sheet.w, sheet.h);
    const r = sheetMax / 320; // dot radius: ~10 pt on an A0 sheet, ~4 pt on A3
    const fs = r * 1.05;
    // Make room for the legend beside the drawing, then re-express positions on the bigger sheet.
    const panel = legendPanel(sheet.w, sheet.h);
    extendSheet(page, panel.side, panel.extra);
    const { w, h } = displaySize(page);
    const su = sheet.w / w, sv = sheet.h / h;
    const at = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x * su, y: p.y * sv });
    const here = markers.filter((x) => x.page === n).map(at);
    const runs = cables.filter((c) => c.page === n && c.points.length > 1).map((c) => ({ ...c, points: c.points.map(at) }));
    // The new panel is white (and hides anything outside the original crop), with a rule along the drawing.
    const margin = sheetMax / 60;
    const area = panel.side === "right"
      ? { x: sheet.w + margin, y: margin, w: w - sheet.w - margin * 2, h: h - margin * 2 }
      : { x: margin, y: sheet.h + margin, w: w - margin * 2, h: h - sheet.h - margin * 2 };
    if (panel.side === "right") {
      rect(page, su, 0, 1, 1, { fill: rgb(1, 1, 1) });
      rect(page, su, 0, su + Math.max(0.6, sheetMax / 1500) / w, 1, { fill: rgb(0.55, 0.55, 0.55) });
    } else {
      rect(page, 0, sv, 1, 1, { fill: rgb(1, 1, 1) });
      rect(page, 0, sv, 1, sv + Math.max(0.6, sheetMax / 1500) / h, { fill: rgb(0.55, 0.55, 0.55) });
    }
    // The project company's logo at the top of the legend panel; the legend goes underneath.
    if (logo) {
      const lh0 = Math.min(sheetMax / 28, area.h * 0.2), lw0 = Math.min(area.w * 0.5, (logo.width / logo.height) * lh0);
      const lh = (logo.height / logo.width) * lw0;
      const p = displayToPdf(page, area.x / w, (area.y + lh) / h); // bottom-left of the logo as displayed
      page.drawImage(logo, { x: p.x, y: p.y, width: lw0, height: lh, rotate: degrees(p.rot) });
      const gap = lh + sheetMax / 120;
      area.y += gap; area.h -= gap;
    }

    // Cables first, so the device dots sit on top of them: a white edge, then the system colour.
    for (const pass of [0, 1]) {
      for (const c of runs) {
        const pts = c.points.map((p) => displayToPdf(page, p.x, p.y));
        for (let k = 1; k < pts.length; k++) {
          page.drawLine({ start: pts[k - 1], end: pts[k], thickness: pass ? r * 0.38 : r * 0.7, color: pass ? hex(c.color) : rgb(1, 1, 1), opacity: pass ? 1 : 0.85, lineCap: LineCapStyle.Round });
        }
      }
    }
    for (const c of runs) {
      if (!c.label) continue;
      let best = 1, len = -1;
      for (let k = 1; k < c.points.length; k++) { const l = Math.hypot((c.points[k].x - c.points[k - 1].x) * w, (c.points[k].y - c.points[k - 1].y) * h); if (l > len) { len = l; best = k; } }
      const a = c.points[best - 1], b = c.points[best];
      const label = safe(c.label);
      const lw = regular.widthOfTextAtSize(label, fs * 0.9);
      const cu = (a.x + b.x) / 2 - lw / 2 / w, cv = (a.y + b.y) / 2 + (fs * 0.3) / h;
      rect(page, cu - (fs * 0.25) / w, cv - (fs * 0.95) / h, cu + (lw + fs * 0.25) / w, cv + (fs * 0.3) / h, { fill: rgb(1, 1, 1), border: hex(c.color), opacity: 0.95 });
      text(page, regular, label, cu, cv, fs * 0.9);
    }

    for (const m of here) {
      const c = displayToPdf(page, m.x, m.y);
      symbol(page, c.x, c.y, m.box ? r * 1.15 : r, m.color, m.box, r * 0.18);
      const tag = safe(m.short).slice(0, 3);
      const tagSize = fs * (tag.length > 2 ? 0.62 : 0.8);
      const tw = bold.widthOfTextAtSize(tag, tagSize);
      text(page, bold, tag, m.x - tw / 2 / w, m.y + (tagSize * 0.35) / h, tagSize, rgb(1, 1, 1));
      // Label to the right of the dot on a white background so it stays readable over linework.
      const label = safe(m.label);
      const lw = regular.widthOfTextAtSize(label, fs);
      const lu = m.x + (r * (m.box ? 1.6 : 1.3)) / w, lv = m.y + (fs * 0.35) / h;
      rect(page, lu - (fs * 0.2) / w, lv - (fs * 1.0) / h, lu + (lw + fs * 0.2) / w, lv + (fs * 0.3) / h, { fill: rgb(1, 1, 1), opacity: 0.85 });
      text(page, regular, label, lu, lv, fs);
    }

    const entries = sortEntries([...here.map(toEntry), ...runs.map((c): Entry => ({ short: "", color: c.color, label: c.label ?? `${c.layer} cable`, kind: `${c.layer} cable`, detail: c.detail ?? "", layer: c.layer, page: n, line: true }))]);
    const keys = keyRows(entries);
    const fonts = { bold, regular };
    if (!sheetLegend(page, fonts, title, entries, keys, layersLine, full, null, area, sheetMax)) {
      overflow.push(...entries);
      sheetLegend(page, fonts, title, entries, keys, layersLine, false, `Full device list: legend page${entries.length > 40 ? "s" : ""} at the end of this PDF`, area, sheetMax);
    }
  });

  if (full && overflow.length) legendPages(doc, { bold, regular }, title, sortEntries(overflow), used.size > 1, logo);
  return doc.save({ useObjectStreams: true });
}
