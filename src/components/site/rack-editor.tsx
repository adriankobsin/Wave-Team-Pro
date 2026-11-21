"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { deleteRackItem, placeRackItem, removeRack, updateRack, updateRackItem } from "@/server/actions/racks";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type RackItem = {
  id: string; u_bottom: number; u_size: number; kind: string; label: string;
  manufacturer: string | null; model: string | null; device_id: string | null; notes: string | null;
};
export type RackDevice = { id: string; name: string; type: string | null; manufacturer: string | null; model: string | null; room: string | null; placedIn: string | null };
type Pick = { label: string; kind: string; u_size: number; manufacturer?: string | null; model?: string | null; device_id?: string | null };

const KIND_LABEL: Record<string, string> = {
  equipment: "Equipment", switch: "Switch", patch_panel: "Patch panel", brush: "Brush plate", ups: "UPS", pdu: "PDU",
  shelf: "Shelf", blank: "Blank panel", fan: "Fan tray", other: "Other",
};
const KIND_STYLE: Record<string, string> = {
  equipment: "bg-brass-soft border-brass/60",
  switch: "bg-sky-100 border-sky-400 dark:bg-sky-950 dark:border-sky-700",
  patch_panel: "bg-panel-sunk border-line",
  brush: "bg-zinc-200 border-zinc-400 dark:bg-zinc-800 dark:border-zinc-600",
  ups: "bg-ok-soft border-ok/50",
  pdu: "bg-ok-soft border-ok/50",
  shelf: "bg-panel border-ink-muted/50 border-dashed",
  blank: "bg-panel-sunk border-line border-dashed",
  fan: "bg-panel-sunk border-line",
  other: "bg-panel border-line",
};
const PALETTE: Pick[] = [
  { label: "Shelf", kind: "shelf", u_size: 1 }, { label: "Shelf", kind: "shelf", u_size: 2 }, { label: "Blank panel", kind: "blank", u_size: 1 },
  { label: "Brush plate", kind: "brush", u_size: 1 }, { label: "24P CAT6A patch panel", kind: "patch_panel", u_size: 1 }, { label: "Fibre patch panel", kind: "patch_panel", u_size: 1 },
  { label: "PDU", kind: "pdu", u_size: 1 }, { label: "UPS", kind: "ups", u_size: 2 }, { label: "Fan tray", kind: "fan", u_size: 1 },
];
const kindFor = (type: string | null) => {
  const t = (type ?? "").toLowerCase();
  if (t.includes("switch")) return "switch";
  if (t === "ups") return "ups";
  if (t === "pdu") return "pdu";
  return "equipment";
};
const ROW = 26; // px per U

export function RackEditor({ projectId, rack, items: initial, racks, devices, canLog, canEdit, backHref }: {
  projectId: string; backHref: string; rack: { id: string; name: string; units: number; location: string | null };
  items: RackItem[]; racks: { id: string; name: string }[]; devices: RackDevice[]; canLog: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");
  const [onlyFree, setOnlyFree] = useState(true);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setItems(initial); } // fresh data from the server after a save
  const seq = useRef(0);

  const sel = items.find((i) => i.id === selected) ?? null;
  const units = rack.units;
  const fits = (bottom: number, size: number, ignore?: string) =>
    bottom >= 1 && bottom + size - 1 <= units && !items.some((i) => i.id !== ignore && i.u_bottom <= bottom + size - 1 && bottom <= i.u_bottom + i.u_size - 1);
  /** Where an item of `size` lands when dropped on U `u`: its top at u, else its bottom at u. */
  const landing = (u: number, size: number, ignore?: string) => [u - size + 1, u].find((b) => fits(b, size, ignore)) ?? null;
  const usedU = items.reduce((n, i) => n + i.u_size, 0);

  const run = (optimistic: RackItem[] | null, call: () => Promise<ActionResult & { id?: string }>, after?: (r: ActionResult & { id?: string }) => void) => {
    const prev = items;
    if (optimistic) setItems(optimistic);
    start(async () => {
      const r = await call();
      if (r.ok) { setMsg({ ok: true, text: r.message ?? "Saved." }); after?.(r); router.refresh(); }
      else { setItems(prev); setMsg({ ok: false, text: r.error }); }
    });
  };

  const placeAt = (u: number, p: Pick) => {
    const bottom = landing(u, p.u_size);
    if (bottom === null) { setMsg({ ok: false, text: `${p.u_size}U doesn't fit at U${u}. Pick a free space.` }); return; }
    const temp: RackItem = { id: `new-${(seq.current += 1)}`, u_bottom: bottom, u_size: p.u_size, kind: p.kind, label: p.label, manufacturer: p.manufacturer ?? null, model: p.model ?? null, device_id: p.device_id ?? null, notes: null };
    setPick(null);
    run([...items, temp], () => placeRackItem({ projectId, rackId: rack.id, label: p.label, kind: p.kind, u_size: p.u_size, u_bottom: bottom, manufacturer: p.manufacturer ?? null, model: p.model ?? null, device_id: p.device_id ?? null }),
      (r) => { if (r.id) setSelected(r.id); });
  };
  const moveTo = (item: RackItem, u: number) => {
    const bottom = landing(u, item.u_size, item.id);
    if (bottom === null) { setMsg({ ok: false, text: `${item.label} (${item.u_size}U) doesn't fit at U${u}.` }); return; }
    if (bottom === item.u_bottom) return;
    run(items.map((i) => (i.id === item.id ? { ...i, u_bottom: bottom } : i)), () => updateRackItem({ id: item.id, u_bottom: bottom }));
  };
  const patchItem = (item: RackItem, patch: Partial<RackItem>) => {
    if (patch.u_size !== undefined && !fits(item.u_bottom, patch.u_size, item.id)) {
      const b = [item.u_bottom, item.u_bottom - (patch.u_size - item.u_size)].find((x) => fits(x, patch.u_size!, item.id));
      if (b === undefined) { setMsg({ ok: false, text: `No room to make it ${patch.u_size}U here; move it first.` }); return; }
      patch = { ...patch, u_bottom: b };
    }
    run(items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)), () => updateRackItem({ id: item.id, ...patch }));
  };

  const uAt = (clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const row = Math.floor((clientY - r.top) / ROW);
    return Math.min(units, Math.max(1, units - row));
  };
  const onRackClick = (e: React.MouseEvent) => {
    if (!canLog) return;
    const u = uAt(e.clientY);
    if (pick) placeAt(u, pick);
    else if (sel) moveTo(sel, u);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHoverU(null);
    const u = uAt(e.clientY);
    const raw = e.dataTransfer.getData("application/x-rack");
    if (!raw) return;
    const data = JSON.parse(raw) as { move?: string; pick?: Pick };
    if (data.move) { const it = items.find((i) => i.id === data.move); if (it) moveTo(it, u); }
    else if (data.pick) placeAt(u, data.pick);
  };
  const dragPick = (p: Pick) => (e: React.DragEvent) => { e.dataTransfer.setData("application/x-rack", JSON.stringify({ pick: p })); e.dataTransfer.effectAllowed = "copy"; };

  const hoverSize = pick?.u_size ?? sel?.u_size ?? 1;
  const hoverBottom = hoverU !== null && (pick || sel) ? landing(hoverU, hoverSize, pick ? undefined : sel?.id) : null;
  const shownDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => (!onlyFree || !d.placedIn) && (!q || [d.name, d.type, d.manufacturer, d.model, d.room].some((x) => x?.toLowerCase().includes(q)))).slice(0, 200);
  }, [devices, search, onlyFree]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,460px)_1fr]">
      {/* ---------------- rack elevation */}
      <div className="space-y-2">
        <RackHeader rack={rack} usedU={usedU} backHref={backHref} canLog={canLog} canEdit={canEdit} run={(c) => run(null, c)} />
        {canLog ? (
          <p className="min-h-10 text-sm text-ink-muted">
            {pick ? <>Placing <b className="text-ink">{pick.label} ({pick.u_size}U)</b>: click a free U in the rack or drag it there. <button type="button" className="underline" onClick={() => setPick(null)}>Cancel</button></>
              : sel ? <>Selected <b className="text-ink">{sel.label}</b>: click a free U to move it there, or drag it. <button type="button" className="underline" onClick={() => setSelected(null)}>Deselect</button></>
              : "Click an item to edit or move it. Drag devices or parts from the right into the rack."}
          </p>
        ) : null}
        <div className="flex rounded-lg border-2 border-ink/70 bg-panel p-1 shadow-sm">
          <UNumbers units={units} />
          <div ref={box} className={cn("relative flex-1 bg-panel-sunk/40", canLog && (pick || sel) && "cursor-copy")} style={{ height: units * ROW }}
            onClick={onRackClick}
            onDragOver={(e) => { if (canLog) { e.preventDefault(); setHoverU(uAt(e.clientY)); } }}
            onDragLeave={() => setHoverU(null)} onDrop={onDrop}
            onMouseMove={(e) => { if (canLog && (pick || sel)) setHoverU(uAt(e.clientY)); }} onMouseLeave={() => setHoverU(null)}>
            {Array.from({ length: units }, (_, i) => <div key={i} className="absolute inset-x-0 border-b border-line/60" style={{ top: (i + 1) * ROW - 1 }} />)}
            {hoverBottom !== null ? <div className="pointer-events-none absolute inset-x-0 rounded border-2 border-brass bg-brass/15" style={{ top: (units - (hoverBottom + hoverSize - 1)) * ROW, height: hoverSize * ROW }} /> : null}
            {items.map((i) => (
              <button key={i.id} type="button" draggable={canLog}
                onDragStart={(e) => { e.dataTransfer.setData("application/x-rack", JSON.stringify({ move: i.id })); e.dataTransfer.effectAllowed = "move"; setSelected(i.id); setPick(null); }}
                onClick={(e) => { e.stopPropagation(); setPick(null); setSelected(i.id === selected ? null : i.id); }}
                className={cn("absolute inset-x-0.5 flex items-center gap-2 overflow-hidden rounded border px-2 text-left text-xs", KIND_STYLE[i.kind] ?? KIND_STYLE.other,
                  i.id === selected && "ring-2 ring-brass ring-offset-1", i.id.startsWith("new-") && "opacity-60")}
                style={{ top: (units - (i.u_bottom + i.u_size - 1)) * ROW + 1, height: i.u_size * ROW - 2 }}
                title={`${i.label} · U${i.u_bottom}${i.u_size > 1 ? `–${i.u_bottom + i.u_size - 1}` : ""}`}>
                <span className="truncate font-semibold">{i.label}</span>
                {i.u_size > 1 ? <span className="shrink-0 text-ink-muted">{i.u_size}U</span> : null}
                {i.device_id ? <span className="ml-auto shrink-0 text-[10px] text-ink-muted" title="Linked to a project device">●</span> : null}
              </button>
            ))}
          </div>
          <UNumbers units={units} />
        </div>
        <p className="text-xs text-ink-muted" role="status">{pending ? "Saving…" : msg ? <span className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</span> : null}</p>
      </div>

      {/* ---------------- side panel */}
      <div className="space-y-4">
        {sel && canLog ? (
          <ItemEditor key={sel.id} item={sel} racks={racks.filter((r) => r.id !== rack.id)} devices={devices} pending={pending}
            onPatch={(p) => patchItem(sel, p)}
            onNudge={(d) => { const b = sel.u_bottom + d; if (fits(b, sel.u_size, sel.id)) run(items.map((i) => (i.id === sel.id ? { ...i, u_bottom: b } : i)), () => updateRackItem({ id: sel.id, u_bottom: b })); else setMsg({ ok: false, text: d > 0 ? "No free space directly above." : "No free space directly below." }); }}
            onMoveRack={(rackId) => run(items.filter((i) => i.id !== sel.id), () => updateRackItem({ id: sel.id, rackId }), () => setSelected(null))}
            onRemove={() => run(items.filter((i) => i.id !== sel.id), () => deleteRackItem({ id: sel.id }), () => setSelected(null))} />
        ) : null}

        {canLog ? (
          <section className="rounded-lg border border-line bg-panel p-3">
            <h3 className="mb-2 text-sm font-semibold">Add parts</h3>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((p) => (
                <button key={`${p.label}${p.u_size}`} type="button" draggable onDragStart={dragPick(p)} onClick={() => { setSelected(null); setPick(p); }}
                  className={cn("rounded border px-2 py-1 text-xs", KIND_STYLE[p.kind], pick === p && "ring-2 ring-brass")}>{p.label} · {p.u_size}U</button>
              ))}
            </div>
            <CustomPart onPick={(p) => { setSelected(null); setPick(p); }} />
          </section>
        ) : null}

        <section className="rounded-lg border border-line bg-panel">
          <div className="space-y-2 border-b border-line p-3">
            <h3 className="text-sm font-semibold">Project devices</h3>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, type, brand, room…" className="h-9 w-full rounded-md border border-line bg-panel px-2 text-sm" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Only devices not in a rack yet</label>
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {shownDevices.map((d) => {
              const p: Pick = { label: d.name, kind: kindFor(d.type), u_size: 1, manufacturer: d.manufacturer, model: d.model, device_id: d.id };
              return (
                <li key={d.id}>
                  <button type="button" disabled={!canLog} draggable={canLog} onDragStart={dragPick(p)} onClick={() => { setSelected(null); setPick(p); }}
                    className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-panel-sunk", pick?.device_id === d.id && "bg-brass-soft")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.name}</span>
                      <span className="block truncate text-xs text-ink-muted">{[d.manufacturer, d.model, d.type, d.room].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                    {d.placedIn ? <span className="shrink-0 rounded bg-panel-sunk px-1.5 py-0.5 text-[10px] text-ink-muted">in {d.placedIn}</span> : null}
                  </button>
                </li>
              );
            })}
            {!shownDevices.length ? <li className="p-3 text-sm text-ink-muted">No devices match.</li> : null}
          </ul>
          {pick?.device_id ? (
            <div className="flex items-center gap-2 border-t border-line p-3 text-sm">
              Height
              <select value={pick.u_size} onChange={(e) => setPick({ ...pick, u_size: Number(e.target.value) })} className="h-8 rounded-md border border-line bg-panel px-1">
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}U</option>)}
              </select>
              <span className="text-ink-muted">then click a free U in the rack.</span>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function UNumbers({ units }: { units: number }) {
  return (
    <div className="w-7 shrink-0 select-none font-mono text-[10px] text-ink-muted">
      {Array.from({ length: units }, (_, i) => <div key={i} className="flex items-center justify-center" style={{ height: ROW }}>{units - i}</div>)}
    </div>
  );
}

function RackHeader({ rack, usedU, canLog, canEdit, run, backHref }: { rack: { id: string; name: string; units: number; location: string | null }; usedU: number; backHref: string; canLog: boolean; canEdit: boolean; run: (c: () => Promise<ActionResult>) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rack.name);
  const [units, setUnits] = useState(String(rack.units));
  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold">{rack.name}</h2>
        <span className="text-sm text-ink-muted">{rack.units}U · {usedU}U used · {rack.units - usedU}U free</span>
        {canLog ? <button type="button" className="text-sm underline" onClick={() => setEditing(true)}>Rename / resize</button> : null}
        {canEdit ? <button type="button" className="text-sm text-danger underline" onClick={async () => {
          if (!window.confirm(`Remove ${rack.name} and everything in it?`)) return;
          const r = await removeRack({ id: rack.id });
          if (r.ok) router.push(backHref); else run(async () => r);
        }}>Remove rack</button> : null}
      </div>
    );
  }
  return (
    <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); setEditing(false); run(() => updateRack({ id: rack.id, name: name.trim(), units: Number(units) })); }}>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 block h-9 w-56 rounded-md border border-line bg-panel px-2" /></label>
      <label>Height (U)<input value={units} onChange={(e) => setUnits(e.target.value)} type="number" min={1} max={60} className="mt-1 block h-9 w-20 rounded-md border border-line bg-panel px-2" /></label>
      <button type="submit" className={buttonClass("primary", "sm")}>Save</button>
      <button type="button" className="underline" onClick={() => setEditing(false)}>Cancel</button>
    </form>
  );
}

function CustomPart({ onPick }: { onPick: (p: Pick) => void }) {
  const [label, setLabel] = useState("");
  const [size, setSize] = useState(1);
  const [kind, setKind] = useState("equipment");
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); if (label.trim()) onPick({ label: label.trim(), kind, u_size: size }); }}>
      <label className="min-w-40 flex-1">Something else<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. Kaleidescape Strato" className="mt-1 block h-8 w-full rounded-md border border-line bg-panel px-2 text-sm" /></label>
      <label>Type<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block h-8 rounded-md border border-line bg-panel px-1">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Height<select value={size} onChange={(e) => setSize(Number(e.target.value))} className="mt-1 block h-8 rounded-md border border-line bg-panel px-1">{[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}U</option>)}</select></label>
      <button type="submit" className={buttonClass("secondary", "sm")}>Place it</button>
    </form>
  );
}

function ItemEditor({ item, racks, devices, pending, onPatch, onNudge, onMoveRack, onRemove }: {
  item: RackItem; racks: { id: string; name: string }[]; devices: RackDevice[]; pending: boolean;
  onPatch: (p: Partial<RackItem>) => void; onNudge: (d: number) => void; onMoveRack: (rackId: string) => void; onRemove: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [manufacturer, setManufacturer] = useState(item.manufacturer ?? "");
  const [model, setModel] = useState(item.model ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [toRack, setToRack] = useState("");
  const input = "mt-1 block h-9 w-full rounded-md border border-line bg-panel px-2 text-sm";
  return (
    <section className="rounded-lg border-2 border-brass/60 bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Edit: U{item.u_bottom}{item.u_size > 1 ? `–${item.u_bottom + item.u_size - 1}` : ""}</h3>
        <div className="flex gap-1">
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => onNudge(1)} aria-label="Move up one U">▲ Up</button>
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => onNudge(-1)} aria-label="Move down one U">▼ Down</button>
        </div>
      </div>
      <form className="grid gap-2 text-sm sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onPatch({ label: label.trim() || item.label, manufacturer: manufacturer.trim() || null, model: model.trim() || null, notes: notes.trim() || null }); }}>
        <label className="sm:col-span-2">Name<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className={input} /></label>
        <label>Manufacturer<input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} maxLength={80} list="dl-manufacturers" className={input} /></label>
        <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} maxLength={120} className={input} /></label>
        <label>Type<select value={item.kind} onChange={(e) => onPatch({ kind: e.target.value })} className={input}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Height<select value={item.u_size} onChange={(e) => onPatch({ u_size: Number(e.target.value) })} className={input}>{Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}U</option>)}</select></label>
        <label className="sm:col-span-2">Linked device
          <select value={item.device_id ?? ""} onChange={(e) => onPatch({ device_id: e.target.value || null })} className={input}>
            <option value="">Not linked</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}{d.room ? ` · ${d.room}` : ""}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1 text-sm" /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>Save</button>
          <button type="button" disabled={pending} className="text-danger underline" onClick={onRemove}>Take out of rack</button>
        </div>
      </form>
      {racks.length ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3 text-sm">
          <label className="flex-1">Move to another rack (same U)
            <select value={toRack} onChange={(e) => setToRack(e.target.value)} className={input}><option value="">Choose…</option>{racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <button type="button" disabled={!toRack || pending} className={buttonClass("secondary", "sm")} onClick={() => onMoveRack(toRack)}>Move</button>
        </div>
      ) : null}
    </section>
  );
}
