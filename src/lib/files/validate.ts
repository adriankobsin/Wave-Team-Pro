import "server-only";
import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class UploadError extends Error {}

/** Types we accept, keyed by detected MIME. Text formats have no magic bytes and are handled separately. */
const BINARY_TYPES: Record<string, { ext: string; image?: boolean; label: string }> = {
  "image/jpeg": { ext: "jpg", image: true, label: "JPEG image" },
  "image/png": { ext: "png", image: true, label: "PNG image" },
  "image/webp": { ext: "webp", image: true, label: "WebP image" },
  "application/pdf": { ext: "pdf", label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", label: "Word document" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", label: "Excel spreadsheet" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", label: "PowerPoint" },
};
const TEXT_TYPES: Record<string, string> = { txt: "text/plain", csv: "text/csv", md: "text/markdown" };

export type AllowedKind = "any" | "image-or-pdf";

export type ValidatedUpload = {
  bytes: Buffer;
  mime: string;
  ext: string;
  fileName: string;
  size: number;
  sha256: string;
  isImage: boolean;
};

/** Keeps a readable name but removes path parts, control characters and anything risky. */
export function safeFileName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file")
    .normalize("NFKC")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${base || "file"}.${ext}`;
}

function looksLikeText(bytes: Buffer) {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the real type from the file's bytes (never the name or browser MIME), rejects
 * anything not on the allow-list, and re-encodes images so EXIF/GPS metadata and any
 * appended payloads are dropped.
 */
export async function validateUpload(file: File, kind: AllowedKind = "any"): Promise<ValidatedUpload> {
  if (!file || file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 25 MB or smaller.");
  let bytes: Buffer = Buffer.from(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(bytes);

  let mime: string;
  let ext: string;
  let isImage = false;
  if (detected && BINARY_TYPES[detected.mime]) {
    mime = detected.mime;
    ext = BINARY_TYPES[mime].ext;
    isImage = Boolean(BINARY_TYPES[mime].image);
  } else if (!detected && kind === "any") {
    const claimed = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!TEXT_TYPES[claimed] || !looksLikeText(bytes)) {
      throw new UploadError("This file type isn't allowed. Use images, PDF, Word, Excel, PowerPoint, TXT or CSV.");
    }
    mime = TEXT_TYPES[claimed];
    ext = claimed;
  } else {
    throw new UploadError(
      detected?.mime === "image/heic" || detected?.mime === "image/heif"
        ? "HEIC photos aren't supported yet. Use the camera button or choose JPEG/PNG."
        : kind === "image-or-pdf"
          ? "Use a photo (JPEG, PNG, WebP) or a PDF."
          : "This file type isn't allowed. Use images, PDF, Word, Excel, PowerPoint, TXT or CSV.",
    );
  }
  if (kind === "image-or-pdf" && !isImage && mime !== "application/pdf") {
    throw new UploadError("Use a photo (JPEG, PNG, WebP) or a PDF.");
  }

  if (isImage) {
    try {
      const img = sharp(bytes, { limitInputPixels: 60_000_000, failOn: "error" }).rotate();
      const meta = await img.metadata();
      const tooBig = (meta.width ?? 0) > 3000 || (meta.height ?? 0) > 3000;
      const resized = tooBig ? img.resize(3000, 3000, { fit: "inside" }) : img;
      bytes =
        mime === "image/png"
          ? await resized.png({ compressionLevel: 8 }).toBuffer()
          : mime === "image/webp"
            ? await resized.webp({ quality: 85 }).toBuffer()
            : await resized.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } catch {
      throw new UploadError("This image couldn't be read. Try another photo.");
    }
  }

  return {
    bytes,
    mime,
    ext,
    fileName: safeFileName(file.name || `upload.${ext}`, ext),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    isImage,
  };
}
