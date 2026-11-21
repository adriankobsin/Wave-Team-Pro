import "server-only";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 40_000_000; // decompression-bomb guard
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CropBox = { x: number; y: number; size: number }; // normalized 0..1 of the oriented image
export type AvatarInput = { bytes: Uint8Array; crop?: CropBox | null; rotate?: 0 | 90 | 180 | 270 };
export type AvatarOutput = { full: Buffer; thumb: Buffer; width: number; height: number };

export class AvatarError extends Error {}

/**
 * Validates and re-encodes an uploaded portrait.
 *  - type detected from magic bytes, not the filename or Content-Type header
 *  - EXIF orientation applied, then user rotation and square crop
 *  - output: 512px and 128px WebP with ALL metadata (EXIF, GPS, XMP, ICC) dropped
 */
export async function processAvatar(input: AvatarInput): Promise<AvatarOutput> {
  const { bytes } = input;
  if (bytes.byteLength === 0) throw new AvatarError("The file is empty.");
  if (bytes.byteLength > AVATAR_MAX_BYTES) throw new AvatarError("Use an image under 8 MB.");

  const type = await fileTypeFromBuffer(bytes);
  if (!type || !ALLOWED.has(type.mime)) {
    throw new AvatarError(
      type?.mime === "image/heic" || type?.mime === "image/heif"
        ? "HEIC photos aren't supported yet. Choose JPEG or PNG, or take the photo from the camera button."
        : "Use a JPEG, PNG or WebP image.",
    );
  }

  let oriented: { data: Buffer; info: { width: number; height: number } };
  try {
    oriented = await sharp(bytes, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error" })
      .rotate() // apply EXIF orientation
      .rotate(input.rotate ?? 0)
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AvatarError("This image couldn't be read. Try a different photo.");
  }

  const { width, height } = oriented.info;
  const crop = normalizeCrop(input.crop, width, height);
  const square = sharp(oriented.data, { limitInputPixels: AVATAR_MAX_PIXELS }).extract(crop);

  const full = await square.clone().resize(512, 512, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
  const thumb = await square.clone().resize(128, 128, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  return { full, thumb, width: crop.width, height: crop.height };
}

/** Converts a normalized crop (or a centered default) into an in-bounds pixel square. */
export function normalizeCrop(crop: CropBox | null | undefined, width: number, height: number) {
  const minSide = Math.min(width, height);
  if (!crop) {
    return { left: Math.floor((width - minSide) / 2), top: Math.floor((height - minSide) / 2), width: minSide, height: minSide };
  }
  const size = Math.max(16, Math.min(minSide, Math.round(crop.size * minSide)));
  const left = Math.min(Math.max(0, Math.round(crop.x * width)), width - size);
  const top = Math.min(Math.max(0, Math.round(crop.y * height)), height - size);
  return { left, top, width: size, height: size };
}

export function parseCrop(raw: string | null | undefined): CropBox | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CropBox>;
    const nums = [v.x, v.y, v.size];
    if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) return null;
    if ((v.size as number) <= 0) return null;
    return { x: v.x as number, y: v.y as number, size: v.size as number };
  } catch {
    return null;
  }
}

export function parseRotation(raw: string | null | undefined): 0 | 90 | 180 | 270 {
  const n = Number(raw);
  return n === 90 || n === 180 || n === 270 ? n : 0;
}
