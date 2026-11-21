import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { displayToPdf } from "@/lib/drawings/stamp";
import { BRAND } from "@/lib/brand";

// Small table-report writer for timesheet PDFs (A4 landscape, Helvetica).

const INK = rgb(0.055, 0.165, 0.231);
const MUTED = rgb(0.36, 0.42, 0.45);
const LINE = rgb(0.84, 0.87, 0.86);
const BAND = rgb(0.93, 0.95, 0.94);
const W = 842;
const H = 595;
const M = 36;

/** Helvetica only covers Latin-1 (WinAnsi); anything else becomes "?" rather than failing. */
export function pdfSafe(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^ -~ -ÿ]/g, "?");
}

export type Column = { label: string; width: number; align?: "left" | "right" | "center" };
/** A tick box cell: drawn as an empty square, or ticked. */
export type BoxCell = { box: boolean };

export type RackDrawing = { name: string; units: number; items: { u_bottom: number; u_size: number; kind: string; label: string }[] };
const RACK_FILL: Record<string, [number, number, number]> = {
  equipment: [0.96, 0.9, 0.78], switch: [0.82, 0.9, 0.98], patch_panel: [0.9, 0.91, 0.91], brush: [0.78, 0.79, 0.8], ups: [0.83, 0.93, 0.85],
  pdu: [0.83, 0.93, 0.85], shelf: [1, 1, 1], blank: [0.96, 0.96, 0.96], fan: [0.9, 0.91, 0.91], other: [1, 1, 1],
};

export class PdfReport {
  private constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private footer: string, private logo: PDFImage | null, private numbersAtEnd: boolean) {}
  private page!: PDFPage;
  private y = 0;

  /** `logo`: the company logo PNG, drawn at the top right of every page. */
  static async create(footer: string, logo?: { png: Buffer } | null, opts: { numbersAtEnd?: boolean; noFirstPage?: boolean } = {}) {
    const doc = await PDFDocument.create();
    doc.setCreator(BRAND.product);
    let image: PDFImage | null = null;
    if (logo) {
      try {
        image = await doc.embedPng(logo.png);
      } catch {
        image = null;
      }
    }
    const r = new PdfReport(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), footer, image, Boolean(opts.numbersAtEnd));
    if (!opts.noFirstPage) r.newPage();
    return r;
  }

  private newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
    if (this.logo) {
      const scale = Math.min(150 / this.logo.width, 36 / this.logo.height);
      const w = this.logo.width * scale;
      const h = this.logo.height * scale;
      this.page.drawImage(this.logo, { x: W - M - w, y: H - M - h + 6, width: w, height: h });
    }
    this.page.drawText(this.fit(this.footer, W - 2 * M - 80, 8, this.font), { x: M, y: 18, size: 8, font: this.font, color: MUTED });
    if (!this.numbersAtEnd) this.page.drawText(`Page ${this.doc.getPageCount()}`, { x: W - M - 40, y: 18, size: 8, font: this.font, color: MUTED });
  }

  /** Starts a new page (e.g. a new section). Returns its page number. */
  pageBreak() {
    this.newPage();
    return this.doc.getPageCount();
  }

  get pageCount() {
    return this.doc.getPageCount();
  }

  /**
   * Cover page: the company logo large, the document title, the project name and a block of details.
   */
  cover(o: { company: string; kind: string; title: string; subtitle?: string; details: [string, string][]; generated: string }) {
    const page = this.doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: 14, height: H, color: INK });
    let top = H - 60;
    if (this.logo) {
      const scale = Math.min(260 / this.logo.width, 90 / this.logo.height);
      const w = this.logo.width * scale, h = this.logo.height * scale;
      page.drawImage(this.logo, { x: 60, y: top - h, width: w, height: h });
      top -= h + 40;
    } else {
      page.drawText(this.fit(o.company, W - 120, 22, this.bold), { x: 60, y: top - 22, size: 22, font: this.bold, color: INK });
      top -= 70;
    }
    page.drawText(this.fit(o.kind.toUpperCase(), W - 120, 12, this.bold), { x: 60, y: top - 12, size: 12, font: this.bold, color: MUTED });
    top -= 40;
    page.drawText(this.fit(o.title, W - 120, 34, this.bold), { x: 60, y: top - 34, size: 34, font: this.bold, color: INK });
    top -= 48;
    if (o.subtitle) { page.drawText(this.fit(o.subtitle, W - 120, 14, this.font), { x: 60, y: top - 14, size: 14, font: this.font, color: MUTED }); top -= 34; }
    page.drawLine({ start: { x: 60, y: top }, end: { x: W - 60, y: top }, thickness: 1, color: LINE });
    top -= 26;
    const rows = o.details.filter(([, v]) => v);
    const col = Math.ceil(rows.length / 2);
    rows.forEach(([k, v], i) => {
      const x = i < col ? 60 : W / 2 + 10, y = top - (i % col) * 34;
      page.drawText(this.fit(k, 300, 9, this.font), { x, y: y - 9, size: 9, font: this.font, color: MUTED });
      page.drawText(this.fit(v, W / 2 - 90, 12, this.bold), { x, y: y - 24, size: 12, font: this.bold, color: INK });
    });
    page.drawText(this.fit(`${o.company} · generated ${o.generated}`, W - 120, 9, this.font), { x: 60, y: 36, size: 9, font: this.font, color: MUTED });
  }

  /** Keeps a page for the contents, filled in at the end once every section's page is known. */
  reserveContents() {
    this.newPage();
    return this.page;
  }

  fillContents(page: PDFPage, entries: { title: string; page: number; sub?: boolean }[]) {
    let y = H - M - 16;
    page.drawText("Contents", { x: M, y, size: 16, font: this.bold, color: INK });
    y -= 30;
    for (const e of entries) {
      if (y < M + 20) break;
      const font = e.sub ? this.font : this.bold;
      const size = e.sub ? 9.5 : 11;
      const x = e.sub ? M + 18 : M;
      const num = String(e.page);
      const t = this.fit(e.title, W - 2 * M - 80, size, font);
      page.drawText(t, { x, y, size, font, color: INK });
      const tx = W - M - font.widthOfTextAtSize(num, size);
      page.drawLine({ start: { x: x + font.widthOfTextAtSize(t, size) + 6, y: y + 2 }, end: { x: tx - 6, y: y + 2 }, thickness: 0.4, color: LINE, dashArray: [1, 2] });
      page.drawText(num, { x: tx, y, size, font, color: INK });
      y -= e.sub ? 15 : 20;
    }
  }

  /** Rack elevations, up to four racks side by side per page. */
  racks(list: RackDrawing[]) {
    const perPage = 4, gap = 18, colW = (W - 2 * M - gap * (perPage - 1)) / perPage;
    for (let i = 0; i < list.length; i += perPage) {
      if (i > 0 || this.y < H - M - 60) this.newPage();
      const top = this.y - 4;
      list.slice(i, i + perPage).forEach((r, k) => {
        const x0 = M + k * (colW + gap);
        this.page.drawText(this.fit(r.name, colW, 9.5, this.bold), { x: x0, y: top - 10, size: 9.5, font: this.bold, color: INK });
        const used = r.items.reduce((n, it) => n + it.u_size, 0);
        this.page.drawText(`${r.units}U · ${used}U used`, { x: x0, y: top - 22, size: 7.5, font: this.font, color: MUTED });
        const avail = top - 30 - (M + 4);
        const uh = Math.min(13, avail / r.units);
        const rackTop = top - 30, numW = 14, bx = x0 + numW, bw = colW - numW;
        this.page.drawRectangle({ x: bx, y: rackTop - r.units * uh, width: bw, height: r.units * uh, borderColor: INK, borderWidth: 1.2, color: rgb(0.99, 0.99, 0.99) });
        for (let u = 1; u <= r.units; u++) {
          const yy = rackTop - (r.units - u + 1) * uh;
          if (uh >= 6) this.page.drawText(String(u), { x: x0, y: yy + uh / 2 - 2.2, size: Math.min(6, uh * 0.7), font: this.font, color: MUTED });
          this.page.drawLine({ start: { x: bx, y: yy }, end: { x: bx + bw, y: yy }, thickness: 0.2, color: LINE });
        }
        for (const it of r.items) {
          const yy = rackTop - (r.units - (it.u_bottom + it.u_size - 1)) * uh - it.u_size * uh;
          const [cr, cg, cb] = RACK_FILL[it.kind] ?? RACK_FILL.other;
          this.page.drawRectangle({ x: bx + 1.5, y: yy + 0.6, width: bw - 3, height: it.u_size * uh - 1.2, color: rgb(cr, cg, cb), borderColor: rgb(0.45, 0.47, 0.48), borderWidth: 0.4 });
          const size = Math.min(6.5, uh * 0.62);
          if (size >= 3) this.page.drawText(this.fit(`${it.label}${it.u_size > 1 ? ` (${it.u_size}U)` : ""}`, bw - 8, size, it.kind === "brush" || it.kind === "blank" ? this.font : this.bold), { x: bx + 4, y: yy + (it.u_size * uh) / 2 - size * 0.35, size, font: it.kind === "brush" || it.kind === "blank" ? this.font : this.bold, color: INK });
        }
      });
      this.y = M;
    }
  }

  /** Appends every page of another PDF (e.g. a drawing). Returns the page number of its first page. */
  async appendPdf(bytes: Uint8Array) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const first = this.doc.getPageCount() + 1;
    const pages = await this.doc.copyPages(src, src.getPageIndices());
    for (const p of pages) this.doc.addPage(p);
    return first;
  }

  /** Writes "Page n of N" (and the footer on pages appended from other PDFs). */
  private numberPages() {
    const pages = this.doc.getPages();
    const n = pages.length;
    pages.forEach((page, i) => {
      const label = `Page ${i + 1} of ${n}`;
      const { width, height } = page.getSize();
      if (width === W && height === H && page.getRotation().angle % 360 === 0) {
        page.drawText(label, { x: W - M - this.font.widthOfTextAtSize(label, 8), y: 18, size: 8, font: this.font, color: MUTED });
        return;
      }
      // An appended drawing: any size or rotation. Put a small footer at the bottom right of the sheet as displayed.
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const box = page.getCropBox();
      const dw = rot === 90 || rot === 270 ? box.height : box.width;
      const dh = rot === 90 || rot === 270 ? box.width : box.height;
      const size = Math.max(7, Math.max(dw, dh) / 260);
      const text = `${pdfSafe(this.footer)} · ${label}`;
      const tw = this.font.widthOfTextAtSize(text, size);
      const p = displayToPdf(page, 1 - (tw + size * 2) / dw, 1 - (size * 1.2) / dh);
      const bg = displayToPdf(page, 1 - (tw + size * 2.6) / dw, 1 - (size * 0.4) / dh);
      const bgEnd = displayToPdf(page, 1 - (size * 0.8) / dw, 1 - (size * 2.4) / dh);
      page.drawRectangle({ x: Math.min(bg.x, bgEnd.x), y: Math.min(bg.y, bgEnd.y), width: Math.abs(bg.x - bgEnd.x), height: Math.abs(bg.y - bgEnd.y), color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(text, { x: p.x, y: p.y, size, font: this.font, color: MUTED, rotate: degrees(p.rot) });
    });
  }

  private room(h: number) {
    if (this.y - h < M) this.newPage();
    // Only titles sit beside the logo; everything else starts below it.
    if (this.logo && this.y > H - M - 44) this.y = H - M - 44;
  }

  private fit(text: string, width: number, size: number, font: PDFFont) {
    let t = pdfSafe(text);
    if (font.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t}...`;
  }

  title(text: string, sub?: string) {
    if (this.y - 40 < M) this.newPage();
    const room = this.logo ? W - 2 * M - 170 : W - 2 * M;
    this.page.drawText(this.fit(text, room, 16, this.bold), { x: M, y: this.y - 16, size: 16, font: this.bold, color: INK });
    this.y -= 22;
    if (sub) {
      this.page.drawText(this.fit(sub, room, 10, this.font), { x: M, y: this.y - 10, size: 10, font: this.font, color: MUTED });
      this.y -= 16;
    }
    this.y -= 6;
  }

  heading(text: string, right?: string) {
    this.room(36);
    this.y -= 6;
    this.page.drawText(this.fit(text, 480, 12, this.bold), { x: M, y: this.y - 12, size: 12, font: this.bold, color: INK });
    if (right) {
      const t = this.fit(right, 300, 9, this.font);
      this.page.drawText(t, { x: W - M - this.font.widthOfTextAtSize(t, 9), y: this.y - 11, size: 9, font: this.font, color: MUTED });
    }
    this.y -= 18;
  }

  text(t: string) {
    this.room(14);
    this.page.drawText(this.fit(t, W - 2 * M, 9, this.font), { x: M, y: this.y - 9, size: 9, font: this.font, color: MUTED });
    this.y -= 14;
  }

  table(cols: Column[], rows: (string | number | BoxCell)[][], opts: { totalRow?: boolean } = {}) {
    const total = cols.reduce((n, c) => n + c.width, 0);
    const scale = (W - 2 * M) / total;
    const xs: number[] = [];
    let x = M;
    for (const c of cols) {
      xs.push(x);
      x += c.width * scale;
    }
    const drawRow = (cells: (string | number | BoxCell)[], font: PDFFont, band: boolean) => {
      this.room(16);
      if (band) this.page.drawRectangle({ x: M, y: this.y - 14, width: W - 2 * M, height: 15, color: BAND });
      cells.forEach((v, i) => {
        const w = cols[i].width * scale - 6;
        if (typeof v === "object") {
          this.checkBox(xs[i] + 3 + w / 2 - 5, this.y - 12.5, v.box);
          return;
        }
        const t = this.fit(typeof v === "number" ? v.toFixed(2) : v, w, 8.5, font);
        const tw = font.widthOfTextAtSize(t, 8.5);
        const tx = cols[i].align === "right" ? xs[i] + 3 + w - tw : cols[i].align === "center" ? xs[i] + 3 + (w - tw) / 2 : xs[i] + 3;
        this.page.drawText(t, { x: tx, y: this.y - 10.5, size: 8.5, font, color: INK });
      });
      this.page.drawLine({ start: { x: M, y: this.y - 14 }, end: { x: W - M, y: this.y - 14 }, thickness: 0.5, color: LINE });
      this.y -= 15;
    };
    drawRow(cols.map((c) => c.label), this.bold, true);
    rows.forEach((r, i) => {
      if (this.y - 16 < M) {
        this.newPage();
        drawRow(cols.map((c) => c.label), this.bold, true);
      }
      drawRow(r, opts.totalRow && i === rows.length - 1 ? this.bold : this.font, false);
    });
    this.y -= 8;
  }

  /** A 10 pt square tick box with its bottom-left corner at (x, y); ticked ones get a check mark. */
  private checkBox(x: number, y: number, ticked: boolean) {
    this.page.drawRectangle({ x, y, width: 10, height: 10, borderColor: INK, borderWidth: 0.8, color: rgb(1, 1, 1) });
    if (ticked) {
      this.page.drawLine({ start: { x: x + 2, y: y + 5 }, end: { x: x + 4.2, y: y + 2.2 }, thickness: 1.4, color: INK });
      this.page.drawLine({ start: { x: x + 4.2, y: y + 2.2 }, end: { x: x + 8.4, y: y + 8 }, thickness: 1.4, color: INK });
    }
  }

  /** A wrapped paragraph (9.5 pt) across the page width. */
  paragraph(t: string, opts: { muted?: boolean; size?: number } = {}) {
    const size = opts.size ?? 9.5;
    const max = W - 2 * M;
    const lines: string[] = [];
    for (const para of pdfSafe(t).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.font.widthOfTextAtSize(next, size) > max && line) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    for (const l of lines) {
      this.room(size + 5);
      this.page.drawText(l, { x: M, y: this.y - size, size, font: this.font, color: opts.muted ? MUTED : INK });
      this.y -= size + 4;
    }
    this.y -= 4;
  }

  /** A short list of tick boxes ("System tested end to end"), one per line. */
  checks(items: { label: string; ticked: boolean }[]) {
    for (const it of items) {
      this.room(18);
      this.checkBox(M + 2, this.y - 12, it.ticked);
      this.page.drawText(this.fit(it.label, W - 2 * M - 24, 9.5, this.font), { x: M + 20, y: this.y - 10, size: 9.5, font: this.font, color: INK });
      this.y -= 17;
    }
    this.y -= 4;
  }

  /**
   * Acceptance block kept together on one page: a statement, then name / signature / date for the
   * client and for the contractor's representative, each with a blank line to write on.
   */
  signoff(o: { title: string; statement: string; client: string; company: string; clientName?: string | null }) {
    this.room(132);
    const top = this.y - 4, h = 118, w = W - 2 * M;
    this.page.drawRectangle({ x: M, y: top - h, width: w, height: h, borderColor: INK, borderWidth: 0.9, color: rgb(1, 1, 1) });
    this.page.drawRectangle({ x: M, y: top - 20, width: w, height: 20, color: BAND });
    this.page.drawText(this.fit(o.title, w - 20, 10.5, this.bold), { x: M + 10, y: top - 14, size: 10.5, font: this.bold, color: INK });
    this.page.drawText(this.fit(o.statement, w - 20, 8.5, this.font), { x: M + 10, y: top - 34, size: 8.5, font: this.font, color: MUTED });
    const col = (x: number, who: string, name: string | null | undefined) => {
      this.page.drawText(this.fit(who, 330, 8.5, this.bold), { x, y: top - 52, size: 8.5, font: this.bold, color: INK });
      const line = (label: string, lx: number, lw: number, y: number, value?: string | null) => {
        this.page.drawText(label, { x: lx, y: y + 3, size: 8, font: this.font, color: MUTED });
        const x0 = lx + this.font.widthOfTextAtSize(label, 8) + 5;
        this.page.drawLine({ start: { x: x0, y }, end: { x: lx + lw, y }, thickness: 0.6, color: INK });
        if (value) this.page.drawText(this.fit(value, lw - (x0 - lx) - 4, 9, this.font), { x: x0 + 2, y: y + 3, size: 9, font: this.font, color: INK });
      };
      line("Name", x, 330, top - 70, name);
      line("Signature", x, 215, top - 94);
      line("Date", x + 230, 100, top - 94);
    };
    col(M + 10, `For ${o.client} (client / captain / owner's representative)`, o.clientName);
    this.page.drawLine({ start: { x: M + w / 2 + 10, y: top - 40 }, end: { x: M + w / 2 + 10, y: top - h + 8 }, thickness: 0.5, color: LINE });
    col(M + w / 2 + 24, `For ${o.company}`, null);
    this.y = top - h - 14;
  }

  async bytes() {
    if (this.numbersAtEnd) this.numberPages();
    return Buffer.from(await this.doc.save());
  }
}
