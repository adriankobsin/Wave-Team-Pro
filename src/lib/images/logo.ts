import "server-only";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

export class LogoError extends Error {}

/** Validates an uploaded logo and re-encodes it as a PNG that fits in 600×200 (transparency kept). */
export async function processLogo(bytes: Uint8Array): Promise<{ png: Buffer; width: number; height: number }> {
  if (!bytes.byteLength) throw new LogoError("The file is empty.");
  if (bytes.byteLength > 5 * 1024 * 1024) throw new LogoError("Use a logo under 5 MB.");
  const type = await fileTypeFromBuffer(bytes);
  const text = Buffer.from(bytes.subarray(0, 512)).toString("utf8");
  const svg = !type && /<svg[\s>]/i.test(text);
  if (!svg && (!type || !["image/png", "image/jpeg", "image/webp"].includes(type.mime))) {
    throw new LogoError("Use a PNG, JPEG, WebP or SVG image.");
  }
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error", density: svg ? 300 : undefined })
      .rotate()
      .trim({ threshold: 1 })
      .resize({ width: 600, height: 200, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return { png: data, width: info.width, height: info.height };
  } catch {
    throw new LogoError("That image couldn't be read. Try a PNG.");
  }
}
