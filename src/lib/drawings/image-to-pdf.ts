import { PDFDocument } from "pdf-lib";

/** Image types a drawing can be uploaded as; they are turned into a one-page PDF before upload. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const isImage = (f: { type: string; name: string }) =>
  (IMAGE_TYPES as readonly string[]).includes(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);

const MAX_PT = 14_400; // largest page PDF readers accept (200 in)

/** EXIF orientation of a JPEG (1 = upright; phones often save 6 or 8 and rely on this flag). */
export function jpegOrientation(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let i = 2;
  while (i + 4 <= v.byteLength) {
    const marker = v.getUint16(i);
    const len = v.getUint16(i + 2);
    if (marker === 0xffe1 && i + 10 <= v.byteLength && v.getUint32(i + 4) === 0x45786966) { // "Exif"
      const t = i + 10;
      const little = v.getUint16(t) === 0x4949;
      const u16 = (o: number) => v.getUint16(o, little);
      const u32 = (o: number) => v.getUint32(o, little);
      const ifd = t + u32(t + 4);
      if (ifd + 2 > v.byteLength) return 1;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > v.byteLength) break;
        if (u16(e) === 0x0112) return u16(e + 8) || 1;
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of image data: no EXIF
    i += 2 + len;
  }
  return 1;
}

/** Re-draws an image upright through a canvas (applies EXIF rotation; also converts WebP). */
async function viaCanvas(file: Blob): Promise<{ bytes: Uint8Array; type: "png" | "jpg" }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This image is too large for the browser to process. Save it as a PDF and upload that instead.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error("This image is too large for the browser to process. Save it as a PDF and upload that instead.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "jpg" };
}

/**
 * Turns a PNG/JPEG/WebP drawing into a one-page PDF the same size as the image (about 96 px per inch),
 * so the viewer, layers and the marked-up PDF download work exactly as for a PDF drawing.
 */
export async function imageToPdf(file: File): Promise<File> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const png = file.type === "image/png" || /\.png$/i.test(file.name);
  const jpg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  let kind: "png" | "jpg";
  if (png) kind = "png";
  else if (jpg && jpegOrientation(bytes) === 1) kind = "jpg";
  else ({ bytes, type: kind } = await viaCanvas(file));

  const doc = await PDFDocument.create();
  const image = kind === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const scale = Math.min(0.75, MAX_PT / Math.max(image.width, image.height));
  const w = image.width * scale, h = image.height * scale;
  doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  doc.setTitle(file.name.replace(/\.[^.]+$/, ""));
  const out = await doc.save();
  return new File([out.slice().buffer as ArrayBuffer], `${file.name.replace(/\.[^.]+$/, "")}.pdf`, { type: "application/pdf" });
}
