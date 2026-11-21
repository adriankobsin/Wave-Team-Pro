"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PdfViewer } from "@/components/drawings/pdf-viewer";
import { buttonClass } from "@/components/ui/button";
import { MARKER_LAYER_NAMES, MARKER_KINDS } from "@/lib/site-constants";
import { addCable, addMarker, createLayer, deleteCable, deleteLayer, deleteMarker, moveMarkerWithCables, updateCable, updateLayer, updateMarker } from "@/server/actions/markers";
import { followMarker, isStraight, longerFirst, moveSegment, moveVertex, normalize, routeTo, type Pt } from "@/lib/drawings/route";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type Marker = { id: string; layer_id: string | null; page: number; x: number; y: number; kind: string; label: string; notes: string | null; device_id: string | null; lutron_item_id: string | null; rack_id?: string | null };
export type MarkupDevice = { id: string; name: string; type: string | null; room: string | null; deck: string | null };
export type MarkupKeypad = { id: string; label: string; model: string | null; integration_id: number | null };
type Pick = { kind: string; label?: string; device_id?: string; lutron_item_id?: string; rack_id?: string };
export type Layer = { id: string; name: string; kind: string | null; color: string; sort: number };
export type Cable = { id: string; layer_id: string; page: number; points: Pt[]; label: string | null; cable_type: string | null; rack_id: string | null; notes: string | null };
export type MarkupRack = { id: string; name: string; location: string | null };
const PRESETS: [string, string][] = [["Access points", "access_point"], ["Keypads", "keypad"], ["Touch panels", "touch_panel"], ["Speakers", "speaker"], ["TVs and displays", "tv"], ["Cameras", "camera"], ["Data points", "data_point"], ["Sensors", "sensor"], ["Shades", "shade"], ["Lighting panels", "lighting_panel"], ["Racks", "rack"]];
/** Control boxes, lighting panels and racks are drawn as squares; everything else as round dots. */
const shape = (kind: string) => (MARKER_KINDS[kind]?.box ? "rounded-[3px]" : "rounded-full");

const kindForType = (type: string | null) => {
  const t = (type ?? "").toLowerCase();
  if (t.includes("access point")) return "access_point";
  if (t.includes("touch")) return "touch_panel";
  if (t.includes("display") || t === "tv") return "tv";
  if (t.includes("camera")) return "camera";
  if (t.includes("phone")) return "phone";
  if (t.includes("intercom")) return "intercom";
  if (t.includes("lan port")) return "data_point";
  if (t.includes("speaker") || t.includes("amp")) return "speaker";
  if (t.includes("keypad")) return "keypad";
  return "other";
};

/**
 * A drawing with things placed on it: pick a type (or a project device / Lutron keypad) on the
 * right, then click the drawing. Drag a marker to move it; click it to edit or remove it.
 * Cable runs are drawn per layer, in the layer's colour: click to start, click to bend, click a
 * marker to connect it; runs stay horizontal / vertical unless "Straight lines" is off.
 */
export function DrawingMarkup({ projectId, drawingId, url, fileName, markers, cables: initialCables, layers: initialLayers, devices, keypads, racks, panels, canLog, exportHref }: {
  projectId: string; drawingId: string; url: string; fileName: string; markers: Marker[]; cables: Cable[]; layers: Layer[]; exportHref: string;
  devices: MarkupDevice[]; keypads: MarkupKeypad[]; racks: MarkupRack[]; panels: string[]; canLog: boolean;
}) {
  const router = useRouter();
  // What is on screen is this component's own state: every change shows at once and is saved in the
  // background, in order. The page's data is only taken back in when nothing is being saved or
  // dragged, so a save never moves anything under the pointer.
  const [stableUrl] = useState(url); // the signed link changes on every refresh; reloading the sheet would flash
  const [items, setItems] = useState(markers);
  const [cables, setCables] = useState(initialCables);
  const [seen, setSeen] = useState({ markers, cables: initialCables, layers: initialLayers });
  const [ops, setOps] = useState({ pending: 0, version: 0 });
  const [refreshAt, setRefreshAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [pick, setPick] = useState<Pick | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selCable, setSelCable] = useState<string | null>(null);
  const [layers, setLayers] = useState(initialLayers);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const visible = (layerId: string | null) => !layerId || !hiddenLayers.has(layerId);
  const activeLayer = layers.find((l) => l.id === active) ?? null;
  const [showLabels, setShowLabels] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saving = ops.pending > 0;
  const [tab, setTab] = useState<"devices" | "keypads" | "racks">("devices");
  const [search, setSearch] = useState("");
  const [onlyUnplaced, setOnlyUnplaced] = useState(true);
  const drag = useRef<{ id: string; moved: boolean; x0: number; y0: number; ox: number; oy: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  // Pointer moves arrive faster than the screen redraws: keep the latest and draw once per frame.
  const frame = useRef(0);
  const latest = useRef<(() => void) | null>(null);
  const perFrame = (fn: () => void) => {
    latest.current = fn;
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; const f = latest.current; latest.current = null; f?.(); });
  };
  const dropFrame = () => { cancelAnimationFrame(frame.current); frame.current = 0; latest.current = null; };
  const dragLast = useRef<{ id: string; x: number; y: number } | null>(null);
  const vdragLast = useRef<{ cable: string; points: Pt[] } | null>(null);
  const draftRef = useRef<{ page: number; points: Pt[] } | null>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cable drawing
  const [cableLayer, setCableLayer] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; points: Pt[] } | null>(null);
  const [cursor, setCursor] = useState<{ page: number; x: number; y: number } | null>(null);
  const [straight, setStraight] = useState(true);
  const [flip, setFlip] = useState(false);
  const [shift, setShift] = useState(false);
  const svgBox = useRef<SVGSVGElement | null>(null);
  const vdrag = useRef<{ cable: string; i: number; seg: boolean; moved: boolean; x0: number; y0: number; fx0: number; fy0: number } | null>(null);
  const [extending, setExtending] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [vdragPts, setVdragPts] = useState<{ cable: string; points: Pt[] } | null>(null);
  if (seen.markers !== markers || seen.cables !== initialCables || seen.layers !== initialLayers) {
    setSeen({ markers, cables: initialCables, layers: initialLayers });
    if (ops.pending === 0 && ops.version === refreshAt && !dragPos && !vdragPts) { setItems(markers); setCables(initialCables); setLayers(initialLayers); }
  }
  const putDraft = (d: { page: number; points: Pt[] } | null) => { draftRef.current = d; setDraft(d); };
  const drawing = Boolean(cableLayer);
  const cableLayerObj = layers.find((l) => l.id === cableLayer) ?? null;
  const straightNow = straight !== shift; // hold Shift for the other mode

  const sel = items.find((m) => m.id === selected) ?? null;
  const cableSel = cables.find((c) => c.id === selCable) ?? null;
  const placedDevices = useMemo(() => new Set(items.map((m) => m.device_id).filter(Boolean)), [items]);
  const placedKeypads = useMemo(() => new Set(items.map((m) => m.lutron_item_id).filter(Boolean)), [items]);
  const placedRacks = useMemo(() => new Set(items.map((m) => m.rack_id).filter(Boolean)), [items]);
  const placedPanels = useMemo(() => new Set(items.filter((m) => m.kind === "lighting_panel").map((m) => m.label.trim().toLowerCase())), [items]);
  const showLayer = (id: string) => setHiddenLayers((h) => { const n = new Set(h); n.delete(id); return n; });
  const layerColor = (id: string | null) => layers.find((l) => l.id === id)?.color ?? "#6b7280";

  /** Saves a change that is already on screen. Saves run one after another, in the order they were made. */
  const save = (call: () => Promise<ActionResult>, done?: string) => {
    setErr(null);
    setOps((o) => ({ pending: o.pending + 1, version: o.version + 1 }));
    chain.current = chain.current.then(async () => {
      let r: ActionResult;
      try { r = await call(); } catch { r = { ok: false, error: "That couldn't be saved. Check your connection." }; }
      if (r.ok) setMsg({ ok: true, text: done ?? r.message ?? "Saved." });
      else setErr(`${r.error} The drawing is showing what was saved.`);
      // A failed save leaves the screen ahead of the server: bump the version so it is reloaded.
      setOps((o) => ({ pending: o.pending - 1, version: r.ok ? o.version : o.version + 1 }));
    });
  };
  // Once saving has been quiet for a moment, refresh the page's data behind the scenes.
  useEffect(() => {
    if (ops.pending || ops.version === refreshAt) return;
    const v = ops.version;
    const t = setTimeout(() => { setRefreshAt(v); router.refresh(); }, 1500);
    return () => clearTimeout(t);
  }, [ops, refreshAt, router]);
  const newId = () => crypto.randomUUID();
  const makeLayer = (name: string, kind: string | null): Layer => {
    const l: Layer = { id: newId(), name, kind, color: MARKER_KINDS[kind ?? "other"]?.color ?? "#6b7280", sort: layers.length };
    setLayers((ls) => [...ls, l]);
    save(() => createLayer({ id: l.id, projectId, drawingId, name, kind, color: l.color }), `Layer “${name}” added.`);
    return l;
  };

  /** Pixels → page fractions, from the size the sheet is shown at right now. */
  const tol = (px: number) => {
    const r = svgBox.current?.getBoundingClientRect();
    return r && r.width && r.height ? { x: px / r.width, y: px / r.height } : { x: 0.006, y: 0.006 };
  };
  const aspect = () => {
    const r = svgBox.current?.getBoundingClientRect();
    return r && r.height ? r.width / r.height : 1;
  };
  /** A click close to a marker or a bend of another run snaps onto it. */
  const snap = (x: number, y: number, page: number): Pt => {
    const t = tol(12);
    const near = (p: { x: number; y: number }) => Math.abs(p.x - x) <= t.x && Math.abs(p.y - y) <= t.y;
    const m = items.find((i) => i.page === page && visible(i.layer_id) && near(i));
    if (m) return { x: m.x, y: m.y, m: m.id };
    for (const c of cables) {
      if (c.page !== page || !visible(c.layer_id)) continue;
      const v = c.points.find(near);
      if (v) return { x: v.x, y: v.y, ...(v.m ? { m: v.m } : {}) };
    }
    return { x, y };
  };
  const nextPoints = (from: Pt, to: Pt) => {
    const h = longerFirst(from, to, aspect());
    return routeTo(from, to, { straight: straightNow, horizontalFirst: flip ? !h : h, tol: tol(8) });
  };
  const finishDraft = () => {
    const d = draftRef.current; // not the rendered one: a double-click fires this twice in a row
    if (!d || !cableLayer) return;
    const points = normalize(d.points);
    putDraft(null);
    dropFrame();
    setCursor(null);
    if (points.length < 2) { setExtending(null); return; }
    if (extending) {
      const id = extending;
      setExtending(null);
      setCableLayer(null);
      setCables((cs) => cs.map((c) => (c.id === id ? { ...c, points } : c)));
      setSelCable(id);
      save(() => updateCable({ id, points }), "Cable extended.");
      return;
    }
    // A run that starts or ends on a placed rack goes to that rack.
    const rackOf = (p: Pt) => (p.m ? items.find((m) => m.id === p.m)?.rack_id ?? null : null);
    const rack_id = rackOf(points[points.length - 1]) ?? rackOf(points[0]);
    const cable: Cable = { id: newId(), layer_id: cableLayer, page: d.page, points, label: null, cable_type: null, rack_id, notes: null };
    setCables((cs) => [...cs, cable]);
    setSelCable(cable.id);
    save(() => addCable({ id: cable.id, projectId, drawingId, layerId: cableLayer, page: d.page, points, rack_id }), "Cable drawn. Click to start the next one, or click it to name it.");
  };
  const addDraftPoint = (p: Pt, page: number) => {
    setSelCable(null);
    const d = draftRef.current;
    if (!d || d.page !== page) { putDraft({ page, points: [p] }); return; }
    const last = d.points[d.points.length - 1];
    const t = tol(5);
    if (Math.abs(last.x - p.x) <= t.x && Math.abs(last.y - p.y) <= t.y) { finishDraft(); return; } // clicking the last point again finishes
    putDraft({ page, points: [...d.points, ...nextPoints(last, p)] });
    setFlip(false);
  };
  const stopCables = () => { setCableLayer(null); putDraft(null); dropFrame(); setCursor(null); setExtending(null); };
  const startExtend = (c: Cable, fromStart: boolean) => {
    setPick(null); setActive(null); setSelected(null); setSelCable(null);
    showLayer(c.layer_id);
    setCableLayer(c.layer_id);
    setExtending(c.id);
    putDraft({ page: c.page, points: fromStart ? [...c.points].reverse() : c.points });
  };
  const removeCable = (c: Cable) => {
    if (!window.confirm(`Delete the cable${c.label ? ` “${c.label}”` : ""}? This can't be undone.`)) return;
    setCables((cs) => cs.filter((x) => x.id !== c.id));
    setSelCable(null);
    save(() => deleteCable({ id: c.id }));
  };

  useEffect(() => {
    if (!drawing && !selCable) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShift(true);
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (!drawing) {
        const c = cables.find((x) => x.id === selCable);
        if (!c || !canLog) return;
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeCable(c); }
        else if (e.key === "Escape") { e.preventDefault(); setSelCable(null); }
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); finishDraft(); }
      else if (e.key === "Escape") { e.preventDefault(); if (draft && !extending) putDraft(null); else stopCables(); }
      else if (e.key === "Backspace" && draft) { e.preventDefault(); putDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null); }
      else if (e.key.toLowerCase() === "f") setFlip((f) => !f);
    };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShift(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const nextLabel = (kind: string) => `${MARKER_KINDS[kind].short} ${items.filter((m) => m.kind === kind).length + 1}`;
  const place = (x: number, y: number, page: number) => {
    if (!canLog) return;
    if (drawing) { addDraftPoint(snap(x, y, page), page); return; }
    if (!pick) { setSelected(null); setSelCable(null); return; }
    const label = pick.label ?? nextLabel(pick.kind);
    // No layer chosen: use (or start) the layer for this type, e.g. "Access points", and keep placing on it.
    let layerId = active;
    if (!layerId) {
      const name = MARKER_LAYER_NAMES[pick.kind] ?? "Other";
      layerId = (layers.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? makeLayer(name, pick.kind)).id;
      setActive(layerId);
    }
    showLayer(layerId);
    const marker: Marker = { id: newId(), layer_id: layerId, page, x, y, kind: pick.kind, label, notes: null, device_id: pick.device_id ?? null, lutron_item_id: pick.lutron_item_id ?? null, rack_id: pick.rack_id ?? null };
    const once = Boolean(pick.device_id || pick.lutron_item_id || pick.rack_id || (pick.label && pick.kind === "lighting_panel"));
    if (once) { setPick(null); dropFrame(); setCursor(null); } // a specific device, rack or panel goes on once; a plain type keeps placing
    setItems((is) => [...is, marker]);
    setSelCable(null);
    setSelected(once ? marker.id : null);
    save(() => addMarker({ id: marker.id, projectId, drawingId, layerId, page, x, y, kind: marker.kind, label, device_id: marker.device_id, lutron_item_id: marker.lutron_item_id, rack_id: marker.rack_id }));
  };

  /** Cables with any point pinned to this marker, re-routed to where it is now. */
  const following = (id: string, x: number, y: number) =>
    cables.filter((c) => c.points.some((p) => p.m === id)).map((c) => ({ id: c.id, points: followMarker(c.points, id, { x, y }, isStraight(c.points)) }));

  const onPointerDown = (m: Marker) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canLog || drawing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Remember where on the symbol it was grabbed, so it doesn't jump under the pointer.
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    drag.current = { id: m.id, moved: false, x0: e.clientX, y0: e.clientY, ox: e.clientX - (box.left + m.x * box.width), oy: e.clientY - (box.top + m.y * box.height) };
    dragLast.current = null;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const pos = { id: d.id, x: Math.min(1, Math.max(0, (e.clientX - d.ox - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - d.oy - box.top) / box.height)) };
    dragLast.current = pos;
    perFrame(() => setDragPos(pos));
  };
  const onPointerCancel = () => { drag.current = null; dragLast.current = null; dropFrame(); setDragPos(null); };
  const onPointerUp = (m: Marker) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (drawing) { if (canLog) addDraftPoint({ x: m.x, y: m.y, m: m.id }, m.page); return; }
    const d = drag.current, pos = dragLast.current;
    drag.current = null;
    dragLast.current = null;
    dropFrame();
    setDragPos(null);
    if (d?.moved && pos) {
      const { x, y } = pos;
      const moved = following(m.id, x, y);
      setItems((is) => is.map((i) => (i.id === m.id ? { ...i, x, y } : i)));
      if (!moved.length) { save(() => updateMarker({ id: m.id, x, y })); return; }
      setCables((cs) => cs.map((c) => { const f = moved.find((x) => x.id === c.id); return f ? { ...c, points: f.points } : c; }));
      save(() => moveMarkerWithCables({ id: m.id, x, y, cables: moved }));
    } else if (d) {
      setPick(null);
      setSelCable(null);
      setSelected(m.id === selected ? null : m.id);
    }
  };

  // Dragging a bend of the selected cable.
  const onVertexDown = (c: Cable, i: number) => (e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (!canLog) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    vdragLast.current = null;
    vdrag.current = { cable: c.id, i, seg: false, moved: false, x0: e.clientX, y0: e.clientY, fx0: (e.clientX - box.left) / box.width, fy0: (e.clientY - box.top) / box.height };
  };
  const onSegmentDown = (c: Cable, i: number) => (e: React.PointerEvent<HTMLSpanElement>) => {
    onVertexDown(c, i)(e);
    if (vdrag.current) vdrag.current.seg = true;
  };
  const onVertexMove = (c: Cable) => (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = vdrag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    const square = isStraight(c.points) && straightNow;
    const pinned = c.points[d.i].m;
    const to = pinned ? c.points[d.i] : { x, y }; // a point on a marker moves with the marker, not on its own
    const next = { cable: c.id, points: d.seg ? moveSegment(c.points, d.i, x - d.fx0, y - d.fy0, square) : moveVertex(c.points, d.i, to, square) };
    vdragLast.current = next;
    perFrame(() => setVdragPts(next));
  };
  const onVertexUp = (c: Cable) => (e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    const d = vdrag.current, last = vdragLast.current;
    vdrag.current = null;
    vdragLast.current = null;
    dropFrame();
    setVdragPts(null);
    if (!d?.moved || !last) return;
    const points = normalize(last.points);
    if (points.length < 2) return;
    setCables((cs) => cs.map((x) => (x.id === c.id ? { ...x, points } : x)));
    save(() => updateCable({ id: c.id, points }));
  };
  const onVertexCancel = () => { vdrag.current = null; vdragLast.current = null; dropFrame(); setVdragPts(null); };
  const removeVertex = (c: Cable, i: number) => {
    if (c.points.length <= 2) return;
    const points = normalize(c.points.filter((_, j) => j !== i));
    if (points.length < 2) return;
    setCables((cs) => cs.map((x) => (x.id === c.id ? { ...x, points } : x)));
    save(() => updateCable({ id: c.id, points }));
  };

  const pointsOf = (c: Cable): Pt[] => {
    if (vdragPts?.cable === c.id) return vdragPts.points;
    if (dragPos && c.points.some((p) => p.m === dragPos.id)) return followMarker(c.points, dragPos.id, dragPos, isStraight(c.points));
    return c.points;
  };
  const svgPoints = (pts: Pt[]) => pts.map((p) => `${(p.x * 1000).toFixed(2)},${(p.y * 1000).toFixed(2)}`).join(" ");
  const markerLabel = new Map(items.map((m) => [m.id, m.label]));
  const rackName = new Map(racks.map((r) => [r.id, r.name]));

  const cableOverlay = (page: number) => {
    const shown = cables.filter((c) => c.page === page && visible(c.layer_id) && c.id !== extending);
    let preview: Pt[] | null = null;
    if (draft && draft.page === page) {
      preview = draft.points;
      if (cursor && cursor.page === page) {
        const target = snap(cursor.x, cursor.y, page);
        preview = [...draft.points, ...nextPoints(draft.points[draft.points.length - 1], target)];
      }
    }
    return (
      <svg ref={svgBox} viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {shown.map((c) => {
          const pts = svgPoints(pointsOf(c));
          const isSel = c.id === selCable;
          return (
            <g key={c.id}>
              <polyline points={pts} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={isSel ? 9 : 6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <polyline points={pts} fill="none" stroke={layerColor(c.layer_id)} strokeWidth={isSel ? 5 : 3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {!draft ? (
                <polyline points={pts} fill="none" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); if (drawing) stopCables(); setSelected(null); setPick(null); setSelCable(c.id === selCable ? null : c.id); }} />
              ) : null}
            </g>
          );
        })}
        {preview && cableLayerObj ? (
          <polyline points={svgPoints(preview)} fill="none" stroke={cableLayerObj.color} strokeWidth={3} strokeDasharray="8 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
    );
  };

  const cableTags = (page: number) => cables.filter((c) => c.page === page && visible(c.layer_id)).flatMap((c) => {
    const pts = pointsOf(c);
    const out: ReactNode[] = [];
    const last = pts[pts.length - 1];
    if (c.rack_id && rackName.has(c.rack_id)) {
      out.push(<span key={`${c.id}-rack`} className="absolute -translate-y-full whitespace-nowrap rounded px-1 text-[10px] font-semibold text-white shadow" style={{ left: `${last.x * 100}%`, top: `${last.y * 100}%`, background: layerColor(c.layer_id) }}>→ {rackName.get(c.rack_id)}</span>);
    }
    if ((showLabels || c.id === selCable) && (c.label || c.cable_type)) {
      // On the middle of the longest segment.
      let best = 1, len = -1;
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > len) { len = l; best = i; } }
      const a = pts[best - 1], b = pts[best];
      out.push(<span key={`${c.id}-label`} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border bg-white/95 px-1 text-[10px] font-medium text-black shadow-sm" style={{ left: `${((a.x + b.x) / 2) * 100}%`, top: `${((a.y + b.y) / 2) * 100}%`, borderColor: layerColor(c.layer_id) }}>{[c.label, c.cable_type].filter(Boolean).join(" · ")}</span>);
    }
    if (c.id === selCable && canLog && !drawing) {
      pts.forEach((p, i) => out.push(
        <span key={`${c.id}-v${i}`} role="button" aria-label={`Bend ${i + 1}`} title={p.m ? `On ${markerLabel.get(p.m) ?? "a marker"} (moves with it)` : "Drag to move · double-click to remove"}
          className={cn("pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 border-2 bg-white shadow", p.m ? "cursor-default rounded-full" : "cursor-move")}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, borderColor: layerColor(c.layer_id), touchAction: "none" }}
          onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); if (!p.m) removeVertex(c, i); }}
          onPointerDown={onVertexDown(c, i)} onPointerMove={onVertexMove(c)} onPointerUp={onVertexUp(c)} onPointerCancel={onVertexCancel} />,
      ));
      // A grip in the middle of each segment: drag it to move the whole segment.
      pts.forEach((p, i) => {
        if (!i) return;
        const a = pts[i - 1];
        const hz = Math.abs(a.y - p.y) < 1e-6, vt = Math.abs(a.x - p.x) < 1e-6;
        if (Math.hypot(p.x - a.x, p.y - a.y) < 0.01) return;
        out.push(
          <span key={`${c.id}-s${i}`} role="button" aria-label={`Segment ${i}`} title="Drag to move this part of the cable"
            className={cn("pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white/90 shadow", hz ? "h-2 w-5 cursor-ns-resize" : vt ? "h-5 w-2 cursor-ew-resize" : "size-2.5 cursor-move")}
            style={{ left: `${((a.x + p.x) / 2) * 100}%`, top: `${((a.y + p.y) / 2) * 100}%`, borderColor: layerColor(c.layer_id), touchAction: "none" }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onSegmentDown(c, i)} onPointerMove={onVertexMove(c)} onPointerUp={onVertexUp(c)} onPointerCancel={onVertexCancel} />,
        );
      });
    }
    return out;
  });

  /** What the next click will do: the symbol about to be placed, or the point a cable will snap onto. */
  const ghost = (page: number) => {
    if (!cursor || cursor.page !== page || !canLog) return null;
    if (drawing) {
      const t = snap(cursor.x, cursor.y, page);
      if (t.x === cursor.x && t.y === cursor.y) return null;
      return <span className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white/40" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, borderColor: cableLayerObj?.color ?? "#000" }} />;
    }
    if (!pick) return null;
    const k = MARKER_KINDS[pick.kind] ?? MARKER_KINDS.other;
    return (
      <span className={cn("absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border-2 border-white px-1 text-[10px] font-bold text-white opacity-60 shadow", k.box ? "h-7 min-w-7 rounded-[3px]" : "h-6 min-w-6 rounded-full")}
        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, background: activeLayer?.color ?? k.color }}>{k.short}</span>
    );
  };

  const overlay = (page: number) => (
    <>
      {cableOverlay(page)}
      {cableTags(page)}
      {items.filter((m) => m.page === page && visible(m.layer_id)).map((m) => {
        const k = MARKER_KINDS[m.kind] ?? MARKER_KINDS.other;
        const dragging = dragPos?.id === m.id;
        const p = dragging ? dragPos : m;
        const isSel = m.id === selected;
        return (
          <button key={m.id} type="button" aria-label={`${k.label} ${m.label}`}
            className={cn("pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 select-none", dragging && "z-20", canLog && (drawing ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab"))}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, touchAction: "none" }}
            onClick={(e) => e.stopPropagation()} onPointerDown={onPointerDown(m)} onPointerMove={onPointerMove} onPointerUp={onPointerUp(m)} onPointerCancel={onPointerCancel}>
            <span className={cn("flex items-center justify-center border-2 border-white px-1 text-[10px] font-bold text-white shadow", k.box ? "h-7 min-w-7 rounded-[3px]" : "h-6 min-w-6 rounded-full", isSel && "ring-2 ring-offset-1 ring-black", dragging && "scale-110 shadow-lg")}
              style={{ background: m.layer_id ? layerColor(m.layer_id) : k.color }}>{k.short}</span>
            {showLabels || isSel ? <span className="absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-medium text-black shadow-sm">{m.label}</span> : null}
          </button>
        );
      })}
      {ghost(page)}
    </>
  );

  const q = search.trim().toLowerCase();
  const deviceList = devices.filter((d) => (!onlyUnplaced || !placedDevices.has(d.id)) && (!q || [d.name, d.type, d.room, d.deck].some((x) => x?.toLowerCase().includes(q)))).slice(0, 150);
  const rackList = racks.filter((r) => (!onlyUnplaced || !placedRacks.has(r.id)) && (!q || [r.name, r.location].some((x) => x?.toLowerCase().includes(q))));
  const panelList = panels.filter((p) => (!onlyUnplaced || !placedPanels.has(p.trim().toLowerCase())) && (!q || p.toLowerCase().includes(q)));
  const keypadList = keypads.filter((k) => (!onlyUnplaced || !placedKeypads.has(k.id)) && (!q || [k.label, k.model, String(k.integration_id ?? "")].some((x) => x?.toLowerCase().includes(q)))).slice(0, 150);
  const perLayer = items.reduce<Record<string, number>>((a, m) => (m.layer_id ? { ...a, [m.layer_id]: (a[m.layer_id] ?? 0) + 1 } : a), {});
  const cablesPerLayer = cables.reduce<Record<string, number>>((a, c) => ({ ...a, [c.layer_id]: (a[c.layer_id] ?? 0) + 1 }), {});
  const shownLayerIds = layers.filter((l) => !hiddenLayers.has(l.id)).map((l) => l.id);
  const drawOn = (l: Layer) => {
    stopCables();
    setActive(l.id);
    showLayer(l.id);
    setSelected(null);
    setSelCable(null);
    setPick({ kind: l.kind ?? pick?.kind ?? "other" });
  };
  const drawCables = (l: Layer) => {
    setPick(null);
    setActive(null);
    setSelected(null);
    setSelCable(null);
    putDraft(null);
    showLayer(l.id);
    setCableLayer(l.id);
  };
  const newLayer = (name: string, kind: string | null) => drawOn(layers.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? makeLayer(name, kind));
  const hint = (b: ReactNode) => <b className="font-semibold">{b}</b>;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-2">
        {canLog && !drawing && cableSel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 p-2 text-sm" style={{ borderColor: layerColor(cableSel.layer_id) }}>
            <span className="inline-block h-1.5 w-6 rounded-full" style={{ background: layerColor(cableSel.layer_id) }} />
            <span className="min-w-0 flex-1">
              <b>{cableSel.label ?? `${layers.find((l) => l.id === cableSel.layer_id)?.name ?? ""} cable`}</b>
              {cableSel.cable_type ? <span className="text-ink-muted"> · {cableSel.cable_type}</span> : null}
              {(() => { const via = cableSel.points.filter((p) => p.m && markerLabel.has(p.m)).map((p) => markerLabel.get(p.m!)); return via.length ? <span className="text-ink-muted"> · {via.join(" → ")}</span> : null; })()}
            </span>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => { editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); editorRef.current?.querySelector("input")?.focus(); }}>Edit details</button>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => startExtend(cableSel, false)}>Extend from end</button>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => startExtend(cableSel, true)}>Extend from start</button>
            <button type="button" className={buttonClass("danger", "sm")} onClick={() => removeCable(cableSel)}>Delete</button>
            <button type="button" className="underline" onClick={() => setSelCable(null)}>Done</button>
            <p className="w-full text-xs text-ink-muted">Drag a white square to move a bend, or a white bar to move that part of the cable (it stays square). Double-click a square to remove the bend. Delete key removes the cable; Esc deselects.</p>
          </div>
        ) : null}
        {canLog && drawing && cableLayerObj ? (
          <div className="space-y-2 rounded-lg border-2 p-2 text-sm" style={{ borderColor: cableLayerObj.color }}>
            <p>
              <span className="mr-1 inline-block size-3 rounded-full align-middle" style={{ background: cableLayerObj.color }} />
              {hint(extending ? `Extending a ${cableLayerObj.name} cable` : `Drawing cables on ${cableLayerObj.name}`)}: {draft
                ? <>click to add a bend, click a device to connect it, {hint("double-click")} or {hint("Enter")} to finish.</>
                : <>click a device (or anywhere) to start the cable.</>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={straight} onChange={(e) => setStraight(e.target.checked)} className="size-4" /> Straight lines (90°)</label>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setFlip((f) => !f)} disabled={!straightNow}>Flip bend (F)</button>
              <button type="button" className={buttonClass("secondary", "sm")} disabled={!draft} onClick={() => draft && putDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null)}>Undo point</button>
              <button type="button" className={buttonClass("primary", "sm")} disabled={!draft || draft.points.length < 2} onClick={finishDraft}>Finish cable</button>
              <button type="button" className={buttonClass("ghost", "sm")} disabled={!draft} onClick={() => putDraft(null)}>Cancel cable</button>
              <button type="button" className="ml-auto underline" onClick={stopCables}>Stop drawing cables</button>
            </div>
            <p className="text-xs text-ink-muted">Hold Shift for {straight ? "a free angle" : "straight lines"}. Clicks near a device or another cable&apos;s bend snap onto it. A cable connected to a device follows it when the device is moved.</p>
          </div>
        ) : canLog ? (
          <p className="min-h-6 text-sm">
            {pick ? <><b>Placing {pick.label ?? MARKER_KINDS[pick.kind].label}</b>{activeLayer ? <> on layer <b>{activeLayer.name}</b></> : null}: click on the drawing where it goes{pick.device_id || pick.lutron_item_id || pick.rack_id || (pick.label && pick.kind === "lighting_panel") ? "" : " (keep clicking to add more)"}. <button type="button" className="underline" onClick={() => setPick(null)}>Stop placing</button></>
              : <span className="text-ink-muted">On a layer on the right, click <b>Place devices</b> to put devices on the drawing, or <b>Draw cables</b> to draw the cable runs. Drag a marker to move it; click a marker or a cable to edit it.</span>}
          </p>
        ) : null}
        <PdfViewer url={stableUrl} fileName={fileName} overlay={overlay} onPageClick={place} placing={Boolean(pick) || drawing} height="h-[80vh]"
          onPageMove={canLog && (drawing || pick) ? (x, y, page) => perFrame(() => setCursor({ x, y, page })) : undefined}
          onPageLeave={() => { dropFrame(); setCursor(null); }}
          onPageDoubleClick={drawing ? () => finishDraft() : undefined} />
        <p className="text-xs" role="status">{err ? <span className="text-danger">{err}</span> : saving ? <span className="text-ink-muted">Saving…</span> : msg ? <span className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</span> : null}</p>
      </div>

      <aside className="space-y-4">
        <LayersPanel layers={layers} counts={perLayer} cableCounts={cablesPerLayer} hidden={hiddenLayers} active={pick ? active : null} cableLayer={cableLayer} canLog={canLog} pending={false} showLabels={showLabels}
          onShowLabels={setShowLabels}
          onToggle={(id, on) => setHiddenLayers((h) => { const n = new Set(h); if (on) n.delete(id); else n.add(id); return n; })}
          onOnly={(id) => setHiddenLayers(new Set(layers.filter((l) => l.id !== id).map((l) => l.id)))}
          onAll={(on) => setHiddenLayers(on ? new Set() : new Set(layers.map((l) => l.id)))}
          onDrawOn={drawOn}
          onDrawCables={drawCables}
          onStopDrawing={() => { setActive(null); setPick(null); stopCables(); }}
          onCreate={newLayer}
          onRename={(l) => { const name = window.prompt("Layer name", l.name)?.trim(); if (name && name !== l.name) { setLayers(layers.map((x) => (x.id === l.id ? { ...x, name } : x))); save(() => updateLayer({ id: l.id, name }), "Layer renamed."); } }}
          onColor={(l, color) => { setLayers(layers.map((x) => (x.id === l.id ? { ...x, color } : x))); clearTimeout(colorTimer.current); colorTimer.current = setTimeout(() => save(() => updateLayer({ id: l.id, color }), "Colour saved."), 400); }}
          onDelete={(l) => {
            const nc = cablesPerLayer[l.id] ?? 0;
            if (!window.confirm(`Delete the layer “${l.name}” and the ${perLayer[l.id] ?? 0} item(s)${nc ? ` and ${nc} cable(s)` : ""} on it?`)) return;
            if (active === l.id) { setActive(null); setPick(null); }
            if (cableLayer === l.id) stopCables();
            setCables((cs) => cs.filter((c) => c.layer_id !== l.id));
            setItems((is) => is.filter((m) => m.layer_id !== l.id));
            setLayers((ls) => ls.filter((x) => x.id !== l.id));
            save(() => deleteLayer({ id: l.id }));
          }}
          downloadHref={shownLayerIds.length ? `${exportHref}?layers=${shownLayerIds.join(",")}` : null}
          layerHref={(id) => `${exportHref}?layers=${id}`} />
        {cableSel && canLog ? (
          <CableEditor key={cableSel.id} cable={cableSel} layers={layers} racks={racks} pending={false}
            route={cableSel.points.filter((p) => p.m && markerLabel.has(p.m)).map((p) => markerLabel.get(p.m!)!)}
            onSave={(p) => { setCables((cs) => cs.map((c) => (c.id === cableSel.id ? { ...c, ...p } : c))); save(() => updateCable({ id: cableSel.id, ...p })); }}
            onDelete={() => removeCable(cableSel)} editorRef={editorRef}
            onClose={() => setSelCable(null)} />
        ) : null}
        {sel && canLog ? (
          <MarkerEditor key={sel.id} marker={sel} layers={layers} devices={devices} keypads={keypads} racks={racks} pending={false}
            onSave={(p) => { setItems((is) => is.map((i) => (i.id === sel.id ? { ...i, ...p } : i))); save(() => updateMarker({ id: sel.id, ...p, layer_id: p.layer_id ?? undefined })); }}
            onDelete={() => { setItems((is) => is.filter((i) => i.id !== sel.id)); setSelected(null); save(() => deleteMarker({ id: sel.id })); }}
            onClose={() => setSelected(null)} />
        ) : null}

        {canLog ? (
          <section className="rounded-lg border border-line bg-panel p-3">
            <h3 className="mb-2 text-sm font-semibold">Place a…</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(MARKER_KINDS).map(([k, v]) => (
                <button key={k} type="button" onClick={() => { stopCables(); setSelected(null); setPick({ kind: k }); }}
                  className={cn("flex items-center gap-2 rounded border border-line px-2 py-1.5 text-left text-xs hover:bg-panel-sunk", pick?.kind === k && !pick.device_id && !pick.lutron_item_id && "ring-2 ring-brass")}>
                  <span className={cn("flex h-5 min-w-5 items-center justify-center px-1 text-[9px] font-bold text-white", shape(k))} style={{ background: v.color }}>{v.short}</span>{v.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-line bg-panel">
          <div className="space-y-2 border-b border-line p-3">
            <div className="flex gap-1 text-sm">
              {(["devices", "keypads", "racks"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-md px-2 py-1", tab === t ? "bg-panel-sunk font-semibold" : "text-ink-muted")}>
                  {t === "devices" ? `Project devices (${devices.length})` : t === "keypads" ? `Lutron keypads (${keypads.length})` : `Racks & panels (${racks.length + panels.length})`}
                </button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "devices" ? "Search name, type, room…" : tab === "keypads" ? "Search room, model, ID…" : "Search rack or panel…"} className="h-9 w-full rounded-md border border-line bg-panel px-2 text-sm" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyUnplaced} onChange={(e) => setOnlyUnplaced(e.target.checked)} /> Only ones not on this drawing yet</label>
          </div>
          <ul className="max-h-[40vh] divide-y divide-line overflow-y-auto">
            {tab === "racks" ? (
              <>
                {rackList.map((r) => (
                  <li key={r.id}>
                    <button type="button" disabled={!canLog} onClick={() => { stopCables(); setSelected(null); setPick({ kind: "rack", label: r.name, rack_id: r.id }); }}
                      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-sunk", pick?.rack_id === r.id && "bg-brass-soft")}>
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 text-[9px] font-bold text-white" style={{ background: MARKER_KINDS.rack.color }}>R</span>
                      <span className="min-w-0 flex-1"><span className="block truncate">{r.name}</span><span className="block truncate text-xs text-ink-muted">{["Rack", r.location].filter(Boolean).join(" · ")}</span></span>
                      {placedRacks.has(r.id) ? <span className="text-[10px] text-ok">placed</span> : null}
                    </button>
                  </li>
                ))}
                {panelList.map((p) => (
                  <li key={p}>
                    <button type="button" disabled={!canLog} onClick={() => { stopCables(); setSelected(null); setPick({ kind: "lighting_panel", label: p }); }}
                      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-sunk", pick?.kind === "lighting_panel" && pick.label === p && "bg-brass-soft")}>
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 text-[9px] font-bold text-white" style={{ background: MARKER_KINDS.lighting_panel.color }}>LP</span>
                      <span className="min-w-0 flex-1"><span className="block truncate">{p}</span><span className="block truncate text-xs text-ink-muted">Lighting panel</span></span>
                      {placedPanels.has(p.trim().toLowerCase()) ? <span className="text-[10px] text-ok">placed</span> : null}
                    </button>
                  </li>
                ))}
                {rackList.length + panelList.length === 0 ? <li className="p-3 text-sm text-ink-muted">{racks.length + panels.length ? "Nothing to show." : "No racks or lighting panels in this project yet. Use Place a… → Rack or Lighting panel to draw one anyway."}</li> : null}
              </>
            ) : tab === "devices" ? deviceList.map((d) => {
              const kind = kindForType(d.type);
              return (
                <li key={d.id}>
                  <button type="button" disabled={!canLog} onClick={() => { stopCables(); setSelected(null); setPick({ kind, label: d.name, device_id: d.id }); }}
                    className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-sunk", pick?.device_id === d.id && "bg-brass-soft")}>
                    <span className={cn("flex h-5 min-w-5 items-center justify-center px-1 text-[9px] font-bold text-white", shape(kind))} style={{ background: MARKER_KINDS[kind].color }}>{MARKER_KINDS[kind].short}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate">{d.name}</span><span className="block truncate text-xs text-ink-muted">{[d.type, d.deck, d.room].filter(Boolean).join(" · ")}</span></span>
                    {placedDevices.has(d.id) ? <span className="text-[10px] text-ok">placed</span> : null}
                  </button>
                </li>
              );
            }) : keypadList.map((k) => (
              <li key={k.id}>
                <button type="button" disabled={!canLog} onClick={() => { stopCables(); setSelected(null); setPick({ kind: "keypad", label: k.label, lutron_item_id: k.id }); }}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-sunk", pick?.lutron_item_id === k.id && "bg-brass-soft")}>
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: MARKER_KINDS.keypad.color }}>K</span>
                  <span className="min-w-0 flex-1"><span className="block truncate">{k.label}</span><span className="block truncate text-xs text-ink-muted">{[k.model, k.integration_id ? `ID ${k.integration_id}` : null].filter(Boolean).join(" · ")}</span></span>
                  {placedKeypads.has(k.id) ? <span className="text-[10px] text-ok">placed</span> : null}
                </button>
              </li>
            ))}
            {tab !== "racks" && (tab === "devices" ? deviceList : keypadList).length === 0 ? <li className="p-3 text-sm text-ink-muted">Nothing to show.</li> : null}
          </ul>
        </section>

      </aside>
    </div>
  );
}

function CableEditor({ cable, layers, racks, route, pending, onSave, onDelete, onClose, editorRef }: {
  cable: Cable; layers: Layer[]; racks: MarkupRack[]; route: string[]; pending: boolean;
  onSave: (p: Partial<Cable>) => void; onDelete: () => void; onClose: () => void; editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [label, setLabel] = useState(cable.label ?? "");
  const [type, setType] = useState(cable.cable_type ?? "");
  const [layerId, setLayerId] = useState(cable.layer_id);
  const [rackId, setRackId] = useState(cable.rack_id ?? "");
  const [notes, setNotes] = useState(cable.notes ?? "");
  const input = "mt-1 block h-9 w-full rounded-md border border-line bg-panel px-2 text-sm";
  const color = layers.find((l) => l.id === cable.layer_id)?.color ?? "#6b7280";
  return (
    <section ref={editorRef} className="scroll-mt-4 rounded-lg border-2 bg-panel p-3" style={{ borderColor: color }}>
      <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Edit cable</h3><button type="button" className="text-sm underline" onClick={onClose}>Close</button></div>
      {route.length ? <p className="mb-2 text-xs"><span className="text-ink-muted">Connects:</span> {route.join(" → ")}</p> : null}
      <form className="grid gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); onSave({ label: label.trim() || null, cable_type: type.trim() || null, layer_id: layerId, rack_id: rackId || null, notes: notes.trim() || null }); }}>
        <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className={input} placeholder="e.g. QS link 1, AP run deck 3" /></label>
        <label>Cable type<input value={type} onChange={(e) => setType(e.target.value)} maxLength={60} className={input} placeholder="e.g. CAT6A, Lutron QS, 2 × 1.5 mm²" list="cable-types" /></label>
        <datalist id="cable-types">{["CAT6", "CAT6A", "Lutron QS", "DALI 2-core", "Speaker 2 × 1.5 mm²", "Speaker 2 × 2.5 mm²", "Fibre OM4", "Coax RG6", "HDMI"].map((t) => <option key={t} value={t} />)}</datalist>
        <label>Layer (system)<select value={layerId} onChange={(e) => setLayerId(e.target.value)} className={input}>{layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Goes to rack<select value={rackId} onChange={(e) => setRackId(e.target.value)} className={input}><option value="">Not a rack</option>{racks.map((r) => <option key={r.id} value={r.id}>{r.name}{r.location ? ` · ${r.location}` : ""}</option>)}</select></label>
        <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1 text-sm" placeholder="e.g. via ceiling void, through bulkhead at frame 42" /></label>
        <p className="text-xs text-ink-muted">To change the route, drag the white squares (bends) or white bars (straight parts) on the cable; double-click a square to remove that bend.</p>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>Save</button>
          <button type="button" disabled={pending} className="text-danger underline" onClick={onDelete}>Remove cable</button>
        </div>
      </form>
    </section>
  );
}

function MarkerEditor({ marker, layers, devices, keypads, racks, pending, onSave, onDelete, onClose }: {
  marker: Marker; layers: Layer[]; devices: MarkupDevice[]; keypads: MarkupKeypad[]; racks: MarkupRack[]; pending: boolean;
  onSave: (p: Partial<Marker>) => void; onDelete: () => void; onClose: () => void;
}) {
  const [label, setLabel] = useState(marker.label);
  const [kind, setKind] = useState(marker.kind);
  const [notes, setNotes] = useState(marker.notes ?? "");
  const [deviceId, setDeviceId] = useState(marker.device_id ?? "");
  const [keypadId, setKeypadId] = useState(marker.lutron_item_id ?? "");
  const [rackId, setRackId] = useState(marker.rack_id ?? "");
  const [layerId, setLayerId] = useState(marker.layer_id ?? "");
  const input = "mt-1 block h-9 w-full rounded-md border border-line bg-panel px-2 text-sm";
  return (
    <section className="rounded-lg border-2 border-brass/60 bg-panel p-3">
      <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Edit marker</h3><button type="button" className="text-sm underline" onClick={onClose}>Close</button></div>
      <form className="grid gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); onSave({ label: label.trim() || marker.label, kind, notes: notes.trim() || null, device_id: deviceId || null, lutron_item_id: keypadId || null, rack_id: kind === "rack" ? rackId || null : null, ...(layerId ? { layer_id: layerId } : {}) }); }}>
        <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className={input} /></label>
        <label>Layer<select value={layerId} onChange={(e) => setLayerId(e.target.value)} className={input}>{layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Type<select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>{Object.entries(MARKER_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Project device<select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={input}><option value="">Not linked</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}{d.room ? ` · ${d.room}` : ""}</option>)}</select></label>
        {kind === "keypad" ? (
          <label>Lutron keypad<select value={keypadId} onChange={(e) => setKeypadId(e.target.value)} className={input}><option value="">Not linked</option>{keypads.map((k) => <option key={k.id} value={k.id}>{k.label}{k.integration_id ? ` · ID ${k.integration_id}` : ""}</option>)}</select></label>
        ) : null}
        {kind === "rack" ? (
          <label>Project rack<select value={rackId} onChange={(e) => { setRackId(e.target.value); const r = racks.find((x) => x.id === e.target.value); if (r && (!label.trim() || label === marker.label)) setLabel(r.name); }} className={input}><option value="">Not linked</option>{racks.map((r) => <option key={r.id} value={r.id}>{r.name}{r.location ? ` · ${r.location}` : ""}</option>)}</select></label>
        ) : null}
        <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1 text-sm" placeholder="e.g. 1500 mm AFF, left of door" /></label>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>Save</button>
          <button type="button" disabled={pending} className="text-danger underline" onClick={onDelete}>Remove from drawing</button>
        </div>
      </form>
    </section>
  );
}

function LayersPanel({ layers, counts, cableCounts, hidden, active, cableLayer, canLog, pending, showLabels, onShowLabels, onToggle, onOnly, onAll, onDrawOn, onDrawCables, onStopDrawing, onCreate, onRename, onColor, onDelete, downloadHref, layerHref }: {
  layers: Layer[]; counts: Record<string, number>; cableCounts: Record<string, number>; hidden: Set<string>; active: string | null; cableLayer: string | null; canLog: boolean; pending: boolean; showLabels: boolean;
  onShowLabels: (on: boolean) => void; onToggle: (id: string, on: boolean) => void; onOnly: (id: string) => void; onAll: (on: boolean) => void;
  onDrawOn: (l: Layer) => void; onDrawCables: (l: Layer) => void; onStopDrawing: () => void; onCreate: (name: string, kind: string | null) => void; onRename: (l: Layer) => void; onColor: (l: Layer, color: string) => void; onDelete: (l: Layer) => void;
  downloadHref: string | null; layerHref: (id: string) => string;
}) {
  const [fullLegend, setFullLegend] = useState(true);
  const withLegend = (href: string) => (fullLegend ? href : `${href}${href.includes("?") ? "&" : "?"}legend=key`);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("access_point");
  const taken = new Set(layers.map((l) => l.name.toLowerCase()));
  const presets = PRESETS.filter(([n]) => !taken.has(n.toLowerCase()));
  return (
    <section className="rounded-lg border-2 border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <h3 className="text-sm font-semibold">Layers</h3>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" className="underline" onClick={() => onAll(true)}>Show all</button>
          <button type="button" className="underline" onClick={() => onAll(false)}>Hide all</button>
          <label className="flex items-center gap-1"><input type="checkbox" checked={showLabels} onChange={(e) => onShowLabels(e.target.checked)} /> Labels</label>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {layers.map((l) => {
          const on = !hidden.has(l.id);
          const isActive = active === l.id;
          const isCables = cableLayer === l.id;
          const nc = cableCounts[l.id] ?? 0;
          return (
            <li key={l.id} className={cn("space-y-1.5 px-3 py-2", (isActive || isCables) && "bg-brass-soft/60")}>
              <div className="flex items-center gap-2">
                <input type="checkbox" aria-label={`Show ${l.name}`} checked={on} onChange={(e) => onToggle(l.id, e.target.checked)} className="size-4" />
                {canLog ? (
                  <label className="relative inline-block size-3.5 shrink-0 cursor-pointer rounded-full ring-1 ring-black/20" style={{ background: l.color }} title="Change the colour of this system">
                    <input type="color" value={l.color} onChange={(e) => onColor(l, e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label={`Colour of ${l.name}`} />
                  </label>
                ) : <span className="inline-block size-3 shrink-0 rounded-full" style={{ background: l.color }} />}
                <span className={cn("min-w-0 flex-1 truncate text-sm", !on && "text-ink-muted line-through")}>{l.name} <span className="text-xs text-ink-muted">({counts[l.id] ?? 0}{nc ? ` · ${nc} cable${nc === 1 ? "" : "s"}` : ""})</span></span>
                {isActive ? <span className="rounded bg-brass px-1.5 py-0.5 text-[10px] font-semibold text-white">PLACING</span> : null}
                {isCables ? <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: l.color }}>CABLES</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs">
                {canLog ? (isActive || isCables
                  ? <button type="button" className="font-medium underline" onClick={onStopDrawing}>Stop</button>
                  : <>
                    <button type="button" className="font-medium text-brass underline" onClick={() => onDrawOn(l)}>Place devices</button>
                    <button type="button" className="font-medium underline" style={{ color: l.color }} onClick={() => onDrawCables(l)}>Draw cables</button>
                  </>) : null}
                <button type="button" className="underline" onClick={() => onOnly(l.id)}>Show only this</button>
                <a href={withLegend(layerHref(l.id))} className="underline">Download</a>
                {canLog ? <button type="button" className="underline" onClick={() => onRename(l)}>Rename</button> : null}
                {canLog ? <button type="button" className="text-danger underline" onClick={() => onDelete(l)}>Delete</button> : null}
              </div>
            </li>
          );
        })}
        {!layers.length ? <li className="px-3 py-3 text-sm text-ink-muted">No layers yet. Create one below, e.g. “Access points”.</li> : null}
      </ul>
      {canLog ? (
        <div className="space-y-2 border-t border-line p-3">
          {presets.length ? (
            <div className="flex flex-wrap gap-1.5">
              {presets.map(([n, k]) => (
                <button key={n} type="button" disabled={pending} onClick={() => onCreate(n, k)} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs hover:bg-panel-sunk">
                  <span className={cn("inline-block size-2", shape(k))} style={{ background: MARKER_KINDS[k].color }} />+ {n}
                </button>
              ))}
            </div>
          ) : null}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCreate(name.trim(), kind); setName(""); } }}>
            <label className="min-w-32 flex-1 text-xs">New layer<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Wi-Fi deck 3" className="mt-1 block h-8 w-full rounded-md border border-line bg-panel px-2 text-sm" /></label>
            <label className="text-xs">Places<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block h-8 rounded-md border border-line bg-panel px-1 text-sm">{Object.entries(MARKER_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <button type="submit" disabled={pending || !name.trim()} className={buttonClass("secondary", "sm")}>Add layer</button>
          </form>
        </div>
      ) : null}
      <div className="border-t border-line p-3">
        {downloadHref
          ? <a href={withLegend(downloadHref)} className={cn(buttonClass("primary", "sm"), "w-full justify-center")}>Download PDF with the layers shown</a>
          : <p className="text-xs text-ink-muted">Tick at least one layer to download it.</p>}
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input type="checkbox" checked={fullLegend} onChange={(e) => setFullLegend(e.target.checked)} className="mt-0.5 size-4" />
          <span>Device legend: every device on the drawing with its tag, type, linked device, room, IP and notes. Untick for just the symbol key.</span>
        </label>
        <p className="mt-1 text-xs text-ink-muted">The drawing with the ticked layers marked on it. The legend goes in a panel beside the drawing (below long sheets), so nothing covers it; a long list continues on legend pages at the end. Large sheets take a few seconds.</p>
      </div>
    </section>
  );
}
