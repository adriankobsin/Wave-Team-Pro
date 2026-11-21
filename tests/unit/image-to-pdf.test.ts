import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { imageToPdf, isImage, jpegOrientation } from "@/lib/drawings/image-to-pdf";

const img = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 240, b: 240 } } });

describe("image drawings", () => {
  it("knows which files are images", () => {
    expect(isImage({ type: "image/png", name: "GA.png" })).toBe(true);
    expect(isImage({ type: "", name: "deck 3.JPG" })).toBe(true);
    expect(isImage({ type: "application/pdf", name: "GA.pdf" })).toBe(false);
  });

  it.each([["png", "image/png"], ["jpeg", "image/jpeg"]] as const)("turns a %s into a one-page PDF the shape of the image", async (fmt, type) => {
    const bytes = await img(1600, 900)[fmt]().toBuffer();
    const pdf = await imageToPdf(new File([new Uint8Array(bytes)], `Deck 2 GA.${fmt === "jpeg" ? "jpg" : "png"}`, { type }));
    expect(pdf.name).toBe("Deck 2 GA.pdf");
    expect(pdf.type).toBe("application/pdf");
    const doc = await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width / height).toBeCloseTo(1600 / 900, 3);
    expect(width).toBe(1200); // 0.75 pt per pixel
  });

  it("keeps huge scans within the largest page size PDF readers accept", async () => {
    const bytes = await img(24000, 1000).jpeg().toBuffer();
    const pdf = await imageToPdf(new File([new Uint8Array(bytes)], "long.jpg", { type: "image/jpeg" }));
    const { width } = (await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPage(0).getSize();
    expect(width).toBeLessThanOrEqual(14400);
  });

  it("reads the EXIF orientation phones save (so sideways photos can be turned upright)", async () => {
    const plain = await img(40, 20).jpeg().toBuffer();
    const turned = await img(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(jpegOrientation(new Uint8Array(plain))).toBe(1);
    expect(jpegOrientation(new Uint8Array(turned))).toBe(6);
    expect(jpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });
});
