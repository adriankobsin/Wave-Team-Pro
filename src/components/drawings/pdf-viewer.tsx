"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { buttonClass } from "@/components/ui/button";

const MAX_ZOOM = 12;

/**
 * Zoomable, pannable viewer for large drawings (A0/A1 GA sheets). A low-resolution copy of the
 * whole page sits underneath; the visible part is re-drawn sharp at the current zoom, so even
 * huge sheets stay crisp on phones without hitting the browser's canvas size limits.
 */
export function PdfViewer({ url, fileName, overlay, onPageClick, onPageMove, onPageLeave, onPageDoubleClick, onPageChange, placing, height = "h-[75vh]" }: {
  url: string; fileName: string;
  /** Drawn over the sheet in a box the size of the page, so children positioned in % follow zoom and scroll. */
  overlay?: (page: number) => ReactNode;
  /** A click on the sheet, as fractions of the page width / height (0–1). */
  onPageClick?: (x: number, y: number, page: number) => void;
  /** The pointer moving over the sheet, in the same fractions (used for previews while drawing). */
  onPageMove?: (x: number, y: number, page: number) => void;
  /** The pointer left the sheet. */
  onPageLeave?: () => void;
  onPageDoubleClick?: (x: number, y: number, page: number) => void;
  onPageChange?: (page: number) => void;
  placing?: boolean;
  height?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const detail = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [zoom, setZoom] = useState(1); // 1 = fit width
  const [fit, setFit] = useState(1); // PDF points → CSS px at zoom 1
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const task = useRef<RenderTask | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({ url, isEvalSupported: false, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" }).promise;
        if (!cancelled) setDoc(d);
      } catch {
        if (!cancelled) { setError("The drawing couldn't be opened. Try downloading it instead."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    doc.getPage(pageNo).then(async (p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
      const width = box.current?.clientWidth ?? 800;
      const f = width / vp.width;
      setFit(f);
      setPage(p);
      // The low-resolution base: the whole sheet at about 2× fit, capped well under mobile canvas limits.
      const scale = Math.min(f * 2, Math.sqrt(6_000_000 / (vp.width * vp.height)));
      const v = p.getViewport({ scale });
      const c = base.current!;
      c.width = Math.floor(v.width); c.height = Math.floor(v.height);
      await p.render({ canvasContext: c.getContext("2d")!, viewport: v }).promise;
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [doc, pageNo]);

  const drawDetail = useCallback(() => {
    const b = box.current, c = detail.current;
    if (!page || !b || !c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = b.clientWidth, h = b.clientHeight;
    c.style.left = `${b.scrollLeft}px`; c.style.top = `${b.scrollTop}px`;
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
    task.current?.cancel();
    const v = page.getViewport({ scale: fit * zoom * dpr });
    const t = page.render({ canvasContext: c.getContext("2d")!, viewport: v, transform: [1, 0, 0, 1, -b.scrollLeft * dpr, -b.scrollTop * dpr] });
    task.current = t;
    t.promise.catch(() => {});
  }, [page, fit, zoom]);

  useEffect(() => {
    const b = box.current;
    if (!b) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { if (detail.current) detail.current.style.opacity = "0"; clearTimeout(timer); timer = setTimeout(() => { drawDetail(); if (detail.current) detail.current.style.opacity = "1"; }, 140); };
    later();
    b.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => { b.removeEventListener("scroll", later); window.removeEventListener("resize", later); clearTimeout(timer); };
  }, [drawDetail]);

  // Zoom keeping the point under (cx, cy) where it is.
  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const b = box.current;
    if (!b) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const px = cx ?? b.clientWidth / 2, py = cy ?? b.clientHeight / 2;
    const ratio = z / zoom;
    const sx = (b.scrollLeft + px) * ratio - px, sy = (b.scrollTop + py) * ratio - py;
    setZoom(z);
    requestAnimationFrame(() => { b.scrollLeft = sx; b.scrollTop = sy; });
  }, [zoom]);

  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch arrives as ctrl+wheel
      e.preventDefault();
      const r = b.getBoundingClientRect();
      zoomTo(zoom * Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top);
    };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => { if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoom }; };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return;
      e.preventDefault();
      const r = b.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      zoomTo(pinch.current.z * (dist(e.touches) / pinch.current.d), cx, cy);
    };
    const end = () => { pinch.current = null; };
    b.addEventListener("wheel", wheel, { passive: false });
    b.addEventListener("touchstart", start, { passive: true });
    b.addEventListener("touchmove", move, { passive: false });
    b.addEventListener("touchend", end);
    return () => { b.removeEventListener("wheel", wheel); b.removeEventListener("touchstart", start); b.removeEventListener("touchmove", move); b.removeEventListener("touchend", end); };
  }, [zoom, zoomTo]);

  const vp = page?.getViewport({ scale: fit * zoom });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => zoomTo(zoom / 1.5)} aria-label="Zoom out">−</button>
        <span className="tabular w-14 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => zoomTo(zoom * 1.5)} aria-label="Zoom in">+</button>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => zoomTo(1)}>Fit</button>
        {doc && doc.numPages > 1 ? (
          <label className="flex items-center gap-1">Page
            <select value={pageNo} onChange={(e) => { setLoading(true); setZoom(1); setPageNo(Number(e.target.value)); onPageChange?.(Number(e.target.value)); }} className="h-8 rounded-md border border-line bg-panel px-1">
              {Array.from({ length: doc.numPages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select> of {doc.numPages}
          </label>
        ) : null}
        <a href={url} download={fileName} className="ml-auto underline">Download original PDF</a>
      </div>
      <p className="text-xs text-ink-muted">Pinch or Ctrl + scroll to zoom; drag or scroll to move around.</p>
      <div ref={box} className={`relative ${height} overflow-auto rounded-lg border border-line bg-white`} style={{ touchAction: "pan-x pan-y" }}>
        <div style={{ width: vp ? vp.width : "100%", height: vp ? vp.height : 400, position: "relative", cursor: placing ? "crosshair" : undefined }}
          onClick={(e) => {
            if (!onPageClick || loading) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPageClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, pageNo);
          }}
          onPointerMove={onPageMove ? (e) => {
            if (loading) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPageMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, pageNo);
          } : undefined}
          onPointerLeave={onPageLeave}
          onDoubleClick={onPageDoubleClick ? (e) => {
            if (loading) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPageDoubleClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, pageNo);
          } : undefined}>
          <canvas ref={base} style={{ width: "100%", height: "100%", display: "block" }} aria-label={fileName} role="img" />
          {overlay && !loading ? <div className="pointer-events-none absolute inset-0 z-10 select-none">{overlay(pageNo)}</div> : null}
        </div>
        <canvas ref={detail} className="pointer-events-none absolute transition-opacity" aria-hidden />
        {loading ? <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">Opening drawing…</p> : null}
        {error ? <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
