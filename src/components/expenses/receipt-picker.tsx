"use client";

import { useRef, useState } from "react";
import { Camera, FileUp, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

const MAX_EDGE = 2200;
const MAX_FILES = 5;
const MAX_TOTAL = 4 * 1024 * 1024; // hosting request limit is ~4.5 MB

/** Downscales a photo in the browser so phone pictures fit the upload limit. Text stays legible at this size. */
async function shrink(file: File): Promise<File> {
  const web = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (!file.type.startsWith("image/") || (web && file.size < 900_000)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || (web && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Camera + file picker for receipts. Selected files are shrunk and written into one hidden
 * input named "files", so the surrounding form posts them with everything else.
 */
export function ReceiptPicker({ required }: { required?: boolean }) {
  const target = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function sync(next: File[]) {
    const dt = new DataTransfer();
    next.forEach((f) => dt.items.add(f));
    if (target.current) target.current.files = dt.files;
    setFiles(next);
  }

  async function add(list: FileList | null, input: HTMLInputElement) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    const incoming = await Promise.all(Array.from(list).map(shrink));
    input.value = "";
    let next = [...files, ...incoming];
    if (next.length > MAX_FILES) {
      setError(`Up to ${MAX_FILES} files per expense.`);
      next = next.slice(0, MAX_FILES);
    }
    const total = next.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL) {
      setError("These files are too large to send together. Remove one, or add it after saving.");
      next = files;
    }
    sync(next);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <input ref={target} type="file" name="files" multiple hidden tabIndex={-1} aria-hidden required={required && !files.length} />
      <div className="flex flex-wrap gap-2">
        <label className={buttonClass("primary", "md", "cursor-pointer")}>
          <Camera className="size-4" aria-hidden /> Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => add(e.target.files, e.target)} />
        </label>
        <label className={buttonClass("secondary", "md", "cursor-pointer")}>
          <FileUp className="size-4" aria-hidden /> Upload photo or PDF
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" multiple className="sr-only" onChange={(e) => add(e.target.files, e.target)} />
        </label>
      </div>
      {busy ? <p className="text-sm text-ink-muted" role="status">Preparing…</p> : null}
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      {files.length ? (
        <ul className="space-y-1 text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-panel-sunk px-3 py-1.5">
              <span className="truncate">{f.name} <span className="text-ink-muted">({Math.max(1, Math.round(f.size / 1024))} KB)</span></span>
              <button type="button" onClick={() => sync(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="text-ink-muted hover:text-ink">
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
