import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
vi.mock("server-only", () => ({}));
const { labelsPdf, LABEL_SHEETS } = await import("@/lib/export/labels");
const { rackCode, rackRoom } = await import("@/server/services/labels");

const label = (n: number) => ({ kind: "Patch panel", title: `MEC552-R2-PP${n}`, detail: "24 ports · 24 cables · 6 passed", project: "MY Seabreeze", url: `https://wave-team-pro.example.com/q/k3m9x2a${"bcdefghjkmnpqrstuvwxyz"[n % 22]}` });

describe("QR labels", () => {
  it("knows which patch panels and switches belong to a rack", () => {
    expect(rackCode("552-R2 - NETWORK RACK")).toBe("552-R2");
    expect(rackRoom("552-R2 - NETWORK RACK")).toBe("552");
    expect("MEC552-R2-PP1".includes(rackCode("552-R2 - NETWORK RACK"))).toBe(true);
  });

  it.each(Object.keys(LABEL_SHEETS) as (keyof typeof LABEL_SHEETS)[])("fills %s sheets and starts a new page when one is full", async (sheet) => {
    const per = LABEL_SHEETS[sheet].cols * LABEL_SHEETS[sheet].rows;
    const logo = await sharp({ create: { width: 320, height: 200, channels: 4, background: { r: 14, g: 42, b: 59, alpha: 1 } } }).png().toBuffer();
    const out = await labelsPdf(Array.from({ length: per + 1 }, (_, i) => label(i + 1)), sheet, { png: logo });
    if (process.env.OUT) (await import("node:fs")).writeFileSync(`${process.env.OUT}-${sheet}.pdf`, out);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
  });
});
