"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, RotateCw, Trash2 } from "lucide-react";
import { removeAvatar, uploadAvatar } from "@/server/actions/profile";
import type { ActionResult } from "@/lib/errors";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

const VIEW = 256;
const MAX_BYTES = 8 * 1024 * 1024;

type Loaded = { url: string; img: HTMLImageElement; file: File };

/**
 * Pick or capture a portrait, frame it (drag, zoom, rotate) and upload. The browser only
 * computes the crop box; the server decodes, crops, strips metadata and re-encodes.
 */
export function AvatarEditor({ userId, name, currentUrl, hasAvatar }: { userId: string; name: string; currentUrl: string | null; hasAvatar: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [localError, setLocalError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const [state, action, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const result = await uploadAvatar(prev, fd);
    if (result.ok) setLoaded(null);
    return result;
  }, { ok: true } as ActionResult);
  const [removeState, removeAction, removing] = useActionState(async () => removeAvatar(), { ok: true } as ActionResult);

  const dims = useCallback(
    (img = loaded?.img, rot = rotate, z = zoom) => {
      if (!img) return null;
      const swap = rot === 90 || rot === 270;
      const rw = swap ? img.naturalHeight : img.naturalWidth;
      const rh = swap ? img.naturalWidth : img.naturalHeight;
      return { rw, rh, scale: (VIEW / Math.min(rw, rh)) * z };
    },
    [loaded, rotate, zoom],
  );

  const clampFor = (d: ReturnType<typeof dims>, x: number, y: number) => {
    if (!d) return { x: 0, y: 0 };
    return {
      x: Math.min(0, Math.max(VIEW - d.rw * d.scale, x)),
      y: Math.min(0, Math.max(VIEW - d.rh * d.scale, y)),
    };
  };
  const clamp = (x: number, y: number) => clampFor(dims(), x, y);
  const centered = (d: ReturnType<typeof dims>) =>
    d ? clampFor(d, (VIEW - d.rw * d.scale) / 2, (VIEW - d.rh * d.scale) / 2) : { x: 0, y: 0 };

  function changeZoom(z: number) {
    // Zoom around the centre of the viewport.
    const before = dims();
    const after = dims(loaded?.img, rotate, z);
    if (before && after) {
      const cx = (VIEW / 2 - offset.x) / before.scale;
      const cy = (VIEW / 2 - offset.y) / before.scale;
      setOffset(clampFor(after, VIEW / 2 - cx * after.scale, VIEW / 2 - cy * after.scale));
    }
    setZoom(z);
  }

  function rotateBy90() {
    const next = ((rotate + 90) % 360) as 0 | 90 | 180 | 270;
    setRotate(next);
    setOffset(centered(dims(loaded?.img, next, zoom)));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const d = dims();
    if (!canvas || !loaded || !d) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = VIEW * ratio;
    canvas.height = VIEW * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.save();
    ctx.translate(offset.x + (d.rw * d.scale) / 2, offset.y + (d.rh * d.scale) / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    const w = loaded.img.naturalWidth * d.scale;
    const h = loaded.img.naturalHeight * d.scale;
    ctx.drawImage(loaded.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }, [loaded, offset, rotate, dims]);

  useEffect(() => () => { if (loaded) URL.revokeObjectURL(loaded.url); }, [loaded]);

  function pick(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setLocalError("Use an image under 8 MB.");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setRotate(0);
      setZoom(1);
      setOffset(centered(dims(img, 0, 1)));
      setLoaded({ url, img, file });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setLocalError("This file can't be shown. Use a JPEG, PNG or WebP photo.");
    };
    img.src = url;
  }

  function crop() {
    const d = dims();
    if (!d) return null;
    return {
      x: Math.max(0, -offset.x / d.scale / d.rw),
      y: Math.max(0, -offset.y / d.scale / d.rh),
      size: Math.min(1, 1 / zoom),
    };
  }

  function nudge(dx: number, dy: number) {
    setOffset((o) => clamp(o.x + dx, o.y + dy));
  }

  const message = !state.ok ? state.error : !removeState.ok ? removeState.error : (state.message ?? removeState.message);
  const tone = !state.ok || !removeState.ok ? "danger" : "ok";

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      {loaded ? (
        <div className="space-y-3">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Photo preview. Drag or use arrow keys to reposition."
            tabIndex={0}
            className="size-64 cursor-grab touch-none rounded-full bg-panel-sunk ring-1 ring-line active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setOffset(clamp(drag.current.ox + e.clientX - drag.current.x, drag.current.oy + e.clientY - drag.current.y));
            }}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 5;
              if (e.key === "ArrowLeft") nudge(step, 0);
              else if (e.key === "ArrowRight") nudge(-step, 0);
              else if (e.key === "ArrowUp") nudge(0, step);
              else if (e.key === "ArrowDown") nudge(0, -step);
              else return;
              e.preventDefault();
            }}
          />
          <div className="flex items-center gap-3">
            <label htmlFor="avatar-zoom" className="text-sm text-ink-muted">Zoom</label>
            <input id="avatar-zoom" type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} className="flex-1 accent-[var(--brass)]" />
            <Button variant="secondary" size="sm" onClick={rotateBy90} aria-label="Rotate 90 degrees">
              <RotateCw className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <Avatar id={userId} name={name} src={currentUrl} size="xl" />
      )}

      <div className="space-y-3">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
        <input ref={cameraInput} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
        {loaded ? (
          <form
            action={(fd) => {
              fd.set("avatar", loaded.file);
              fd.set("crop", JSON.stringify(crop()));
              fd.set("rotate", String(rotate));
              action(fd);
            }}
            className="flex flex-wrap gap-2"
          >
            <Button type="submit" disabled={pending}>{pending ? "Uploading…" : "Save photo"}</Button>
            <Button variant="ghost" onClick={() => setLoaded(null)} disabled={pending}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => cameraInput.current?.click()}>
              <Camera className="size-4" aria-hidden />
              Take selfie
            </Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <ImageUp className="size-4" aria-hidden />
              Choose photo
            </Button>
            {hasAvatar ? (
              <form action={removeAction}>
                <Button type="submit" variant="ghost" disabled={removing}>
                  <Trash2 className="size-4" aria-hidden />
                  {removing ? "Removing…" : "Remove"}
                </Button>
              </form>
            ) : null}
          </div>
        )}
        <p className="max-w-sm text-xs text-ink-muted">
          Visible to colleagues in your organizations. We re-save the image and remove hidden data such as location and camera details.
        </p>
        {localError ? <Notice tone="danger">{localError}</Notice> : message ? <Notice tone={tone}>{message}</Notice> : null}
      </div>
    </div>
  );
}
