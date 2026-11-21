"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/link";
import { Badge } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { DECKS, ITEM_STATUS, TEST_RESULT } from "@/lib/site-constants";
import { removeSiteRows, updateCables, updateDevices, updateDevicesStatus } from "@/server/actions/site";
import { removeSwitchRows, updatePorts } from "@/server/actions/switches";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "ok" | "danger" | "warn";
const toneSelect: Record<Tone, string> = {
  neutral: "border-line bg-panel text-ink",
  ok: "border-ok/40 bg-ok-soft text-ok",
  warn: "border-brass/50 bg-brass-soft text-[#7a5a22] dark:text-brass",
  danger: "border-danger/40 bg-danger-soft text-danger",
};
type Msg = { ok: boolean; text: string } | null;

/** Shared state for an editable table: selection, optimistic values, saving and the last message. */
function useEditable() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const toggle = (ids: string[], on: boolean) => setSelected((s) => {
    const n = new Set(s);
    for (const id of ids) { if (on) n.add(id); else n.delete(id); }
    return n;
  });
  /** Applies `patch` to `ids` straight away on screen, then saves; puts it back if saving fails. */
  const save = (ids: string[], patch: Record<string, unknown>, call: () => Promise<ActionResult>, after?: () => void) => {
    const prev = values;
    setValues((v) => {
      const n = { ...v };
      for (const id of ids) n[id] = { ...n[id], ...patch };
      return n;
    });
    start(async () => {
      const r = await call();
      if (r.ok) { setMsg({ ok: true, text: r.message ?? "Saved." }); after?.(); router.refresh(); }
      else { setValues(prev); setMsg({ ok: false, text: r.error }); }
    });
  };
  const get = <T,>(id: string, key: string, fallback: T): T => (values[id] && key in values[id] ? (values[id][key] as T) : fallback);
  const clear = () => setSelected(new Set());
  return { selected, toggle, clear, msg, pending, save, get, setMsg };
}

function Status({ msg, pending }: { msg: Msg; pending: boolean }) {
  return <span className="ml-auto text-sm" role="status">{pending ? <span className="text-ink-muted">Saving…</span> : msg ? <span className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</span> : null}</span>;
}

function Check({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (on: boolean) => void; label: string; indeterminate?: boolean }) {
  return (
    <input type="checkbox" aria-label={label} checked={checked} className="size-4 align-middle"
      ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate); }} onChange={(e) => onChange(e.target.checked)} />
  );
}

/**
 * A table cell you can type into. Looks like plain text until hovered or focused; saves when you
 * press Enter or click away, Esc puts it back.
 */
function EditCell({ value, onSave, label, list, width = "w-full", mono, disabled }: {
  value: string | null; onSave: (v: string | null) => void; label: string; list?: string; width?: string; mono?: boolean; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  if (disabled) return <span className={cn(mono && "tabular")}>{value ?? "—"}</span>;
  return (
    <input aria-label={label} value={shown} placeholder="—" list={list} spellCheck={false}
      className={cn("h-8 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-line focus:border-brass focus:bg-panel focus:outline-none", width, mono && "tabular")}
      onFocus={() => setDraft(value ?? "")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = (draft ?? "").trim() || null;
        setDraft(null);
        if (next !== (value ?? null)) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(value ?? ""); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
      }} />
  );
}

/** Lists offered while typing (decks, rooms already used, manufacturers…). */
export function Suggestions({ lists }: { lists: Record<string, string[] | [string, string][]> }) {
  return (
    <>
      {Object.entries(lists).map(([id, items]) => (
        <datalist key={id} id={id}>
          {items.map((x) => (Array.isArray(x) ? <option key={x[0]} value={x[0]}>{x[1]}</option> : <option key={x} value={x} />))}
        </datalist>
      ))}
    </>
  );
}

/** Top bar: what's selected, "set a common value" and the other bulk actions. */
function BulkBar({ count, fields, onSetField, onClear, msg, pending, children, hint }: {
  count: number; fields: [string, string, string?][]; onSetField: (field: string, value: string | null) => void; onClear: () => void;
  msg: Msg; pending: boolean; children?: ReactNode; hint: string;
}) {
  const [field, setField] = useState(fields[0][0]);
  const [value, setValue] = useState("");
  const listId = fields.find((f) => f[0] === field)?.[2];
  return (
    <div className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2 text-sm">
      {count ? (
        <>
          <span className="font-medium">{count} selected:</span>
          {children}
          <span className="hidden h-5 w-px bg-line sm:block" />
          <label className="flex items-center gap-1.5">Set
            <select value={field} onChange={(e) => setField(e.target.value)} className="h-8 rounded-md border border-line bg-panel px-1.5 text-xs">
              {fields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">to
            <input value={value} onChange={(e) => setValue(e.target.value)} list={listId} placeholder="(empty clears it)" className="h-8 w-40 rounded-md border border-line bg-panel px-2 text-xs" />
          </label>
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => { onSetField(field, value.trim() || null); setValue(""); }}>Apply</button>
          <button type="button" onClick={onClear} className="text-ink-muted underline">Clear selection</button>
        </>
      ) : <span className="text-ink-muted">{hint}</span>}
      <Status msg={msg} pending={pending} />
    </div>
  );
}

const deckLabel = (d: string | null) => (d ? DECKS[d] ?? d : null);

// ------------------------------------------------------------------ cables

export type CableRow = {
  id: string; label: string | null; patch_panel: string; port: number; cable_type: string | null; system: string | null;
  deck: string | null; room: string | null; location: string | null; device_name: string | null; switch_port: string | null;
  test_result: string; length_m: number | null; tested_on: string | null; tested_by: string | null; tested_by_ids: string[] | null; tested_by_name: string | null;
};
const CABLE_BULK: [string, string, string?][] = [["room", "Room / area", "dl-rooms"], ["deck", "Deck", "dl-decks"], ["location", "Location"], ["cable_type", "Cable type", "dl-cable-types"], ["system", "System", "dl-systems"], ["device_name", "Device"], ["switch_port", "Switch port"]];

export type TeamOption = { id: string; name: string; job: string | null };

/**
 * "Tested by": a drop-down with a tick box per person on the project team. Saves when it closes
 * (Done, clicking elsewhere or Esc) if anything changed.
 */
function TesterPicker({ value, team, onSave, disabled, label, children }: {
  value: string[]; team: TeamOption[]; onSave: (ids: string[]) => void; disabled?: boolean; label: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(value);
  const box = useRef<HTMLDivElement>(null);
  const close = (commit: boolean) => {
    setOpen(false);
    if (commit && picked.slice().sort().join() !== value.slice().sort().join()) onSave(picked);
  };
  const latest = useRef(close);
  useEffect(() => { latest.current = close; });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) latest.current(true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") latest.current(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const extra = value.filter((id) => !team.some((m) => m.id === id));
  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => { if (open) close(true); else { setPicked(value); setOpen(true); } }}
        className={cn("flex min-h-8 w-full items-center justify-between gap-1 rounded-md border border-transparent px-1.5 text-left text-xs hover:border-line", !disabled && "cursor-pointer", open && "border-brass")}>
        <span className="min-w-0">{children}</span>
        {!disabled ? <span aria-hidden className="text-ink-muted">▾</span> : null}
      </button>
      {open ? (
        <div role="listbox" aria-multiselectable="true" className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-line bg-panel p-2 text-sm shadow-lg">
          <p className="px-1 pb-1 text-xs text-ink-muted">Tested by (project team)</p>
          {team.length ? (
            <div className="max-h-60 space-y-0.5 overflow-y-auto">
              {[...team, ...extra.map((id) => ({ id, name: "Not on the team now", job: null }))].map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-panel-sunk">
                  <input type="checkbox" className="size-4" checked={picked.includes(m.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.job ? <span className="truncate text-xs text-ink-muted">{m.job}</span> : null}
                </label>
              ))}
            </div>
          ) : <p className="px-1 py-2 text-xs text-ink-muted">Nobody is on this project&apos;s team yet. Add people on the project Overview.</p>}
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button type="button" className="text-xs text-ink-muted underline" onClick={() => setPicked([])}>Clear</button>
            <button type="button" className={buttonClass("primary", "sm")} onClick={() => close(true)}>Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Cable / patch panel schedule: type straight into any cell, pick a test result, or change many rows at once. */
export function CableTable({ rows, base, canLog, canEdit, testers, team, groupByPanel }: { rows: CableRow[]; base: string; canLog: boolean; canEdit: boolean; testers: Record<string, string>; team: TeamOption[]; groupByPanel: boolean }) {
  const t = useEditable();
  const [bulk, setBulk] = useState("passed");
  const v = <K extends keyof CableRow>(r: CableRow, k: K) => t.get<CableRow[K]>(r.id, k as string, r[k]);
  const saveFields = (ids: string[], fields: Record<string, string | null>, after?: () => void) =>
    t.save(ids, fields, () => updateCables({ ids, fields }), after);
  const setResult = (ids: string[], result: string, after?: () => void) =>
    t.save(ids, { test_result: result, _fresh: result !== "not_tested" }, () => updateCables({ ids, test_result: result }), after);
  const setLength = (r: CableRow, raw: string | null) => {
    const n = raw === null ? null : Number(raw.replace(",", "."));
    if (n !== null && (!Number.isFinite(n) || n < 0)) { t.setMsg({ ok: false, text: "Length must be a number of metres." }); return; }
    t.save([r.id], { length_m: n }, () => updateCables({ ids: [r.id], length_m: n }));
  };
  const panels = groupByPanel ? [...new Set(rows.map((r) => r.patch_panel))] : [null];
  const allIds = rows.map((r) => r.id);
  const allOn = allIds.length > 0 && allIds.every((id) => t.selected.has(id));
  const name = (r: CableRow) => r.label ?? `${r.patch_panel} port ${r.port}`;

  const resultControl = (r: CableRow) => {
    const res = v(r, "test_result");
    if (!canLog) return <Badge tone={TEST_RESULT[res].tone}>{TEST_RESULT[res].label}</Badge>;
    return (
      <select aria-label={`Test result for ${name(r)}`} value={res} disabled={t.pending} onChange={(e) => setResult([r.id], e.target.value)}
        className={cn("h-8 w-36 rounded-md border px-1.5 text-xs font-medium", toneSelect[TEST_RESULT[res].tone])}>
        {Object.entries(TEST_RESULT).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
      </select>
    );
  };
  const ids0 = (r: CableRow) => (r.tested_by_ids?.length ? r.tested_by_ids : r.tested_by ? [r.tested_by] : []);
  const nameOf = (id: string) => testers[id] ?? team.find((m) => m.id === id)?.name ?? "Someone";
  const testedText = (r: CableRow) => {
    const res = v(r, "test_result");
    const ids = t.get<string[]>(r.id, "tested_by_ids", ids0(r));
    if (res === "not_tested" && !ids.length) return "—";
    const fresh = t.get(r.id, "_fresh", undefined) !== undefined && res !== r.test_result;
    const who = ids.length ? ids.map(nameOf).join(", ") : fresh ? "You" : r.tested_by_name ? "Imported" : "—";
    const when = fresh || t.get(r.id, "_whoFresh", undefined) !== undefined ? "today" : r.tested_on;
    return when && who !== "—" ? `${who} · ${when}` : who;
  };
  const testedBy = (r: CableRow) => (!canLog ? testedText(r) : (
    <TesterPicker value={t.get<string[]>(r.id, "tested_by_ids", ids0(r))} team={team} disabled={t.pending} label={`Tested by for ${name(r)}`}
      onSave={(ids) => t.save([r.id], { tested_by_ids: ids, _whoFresh: true }, () => updateCables({ ids: [r.id], tested_by_ids: ids }))}>
      {testedText(r)}
    </TesterPicker>
  ));
  const len = (r: CableRow) => { const x = v(r, "length_m"); return x === null ? null : String(Number(x)); };
  const cell = (r: CableRow, k: "deck" | "room" | "location" | "label" | "cable_type" | "system" | "device_name" | "switch_port", label: string, opts: { list?: string; width?: string } = {}) => (
    <EditCell value={v(r, k)} label={`${label} for ${name(r)}`} disabled={!canLog} list={opts.list} width={opts.width}
      onSave={(x) => saveFields([r.id], { [k]: x })} />
  );

  return (
    <div>
      {canLog ? (
        <BulkBar count={t.selected.size} fields={CABLE_BULK} onClear={t.clear} msg={t.msg} pending={t.pending}
          hint="Click any cell to type in it (Enter saves, Esc cancels). Tick rows, or a whole patch panel, to set a common room, deck or test result."
          onSetField={(f, x) => saveFields([...t.selected], { [f]: x }, t.clear)}>
          <label className="flex items-center gap-1.5">Test
            <select value={bulk} onChange={(e) => setBulk(e.target.value)} className={cn("h-8 rounded-md border px-1.5 text-xs font-medium", toneSelect[TEST_RESULT[bulk].tone])}>
              {Object.entries(TEST_RESULT).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={t.pending} className={buttonClass("primary", "sm")} onClick={() => setResult([...t.selected], bulk, t.clear)}>Apply</button>
          <div className="w-40">
            <TesterPicker value={[]} team={team} disabled={t.pending} label="Set tested by for the ticked cables"
              onSave={(ids) => { const sel = [...t.selected]; t.save(sel, { tested_by_ids: ids, _whoFresh: true }, () => updateCables({ ids: sel, tested_by_ids: ids }), t.clear); }}>
              Set tested by…
            </TesterPicker>
          </div>
          {canEdit ? (
            <button type="button" disabled={t.pending} className="text-danger underline"
              onClick={() => { if (window.confirm(`Remove ${t.selected.size} cable${t.selected.size === 1 ? "" : "s"} from the schedule?`)) t.save([...t.selected], {}, () => removeSiteRows({ table: "site_cables", ids: [...t.selected] }), t.clear); }}>Remove</button>
          ) : null}
        </BulkBar>
      ) : null}

      {/* Phone: cards */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-3 px-4 py-3">
            {canLog ? <div className="pt-2"><Check label={`Select ${name(r)}`} checked={t.selected.has(r.id)} onChange={(on) => t.toggle([r.id], on)} /></div> : null}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <label className="text-ink-muted">Deck{cell(r, "deck", "Deck", { list: "dl-decks" })}</label>
                <label className="text-ink-muted">Room / area{cell(r, "room", "Room", { list: "dl-rooms" })}</label>
              </div>
              <Link href={`${base}/site/cables/${r.id}`} className="block break-all font-medium">{v(r, "label") ?? <span className="text-ink-muted">Spare port</span>}</Link>
              <p className="text-xs text-ink-muted">{v(r, "cable_type") ?? "Cable"} · {r.patch_panel} port {r.port}{v(r, "device_name") ? ` · ${v(r, "device_name")}` : ""}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {resultControl(r)}
                <span className="inline-flex items-center gap-1 text-xs"><EditCell value={len(r)} label={`Length for ${name(r)}`} disabled={!canLog} width="w-16" mono onSave={(x) => setLength(r, x)} />m</span>
              </div>
              <div className="text-xs text-ink-muted">{testedBy(r)}</div>
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet / desktop: table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[1250px] text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            {canLog ? <th className="w-8 px-3 py-2"><Check label="Select all on this page" checked={allOn} indeterminate={!allOn && allIds.some((id) => t.selected.has(id))} onChange={(on) => t.toggle(allIds, on)} /></th> : null}
            {["Deck", "Room / area", "Cable", "Patch panel · port", "Cable no.", "Location", "System", "Device", "Switch port", "Length (m)", "Test", "Tested by"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {panels.map((panel) => {
              const list = panel === null ? rows : rows.filter((r) => r.patch_panel === panel);
              const ids = list.map((r) => r.id);
              const on = ids.every((id) => t.selected.has(id));
              const some = ids.some((id) => t.selected.has(id));
              return (
                <Fragment key={panel ?? "all"}>
                  {panel !== null ? (
                    <tr className="border-b border-line bg-panel-sunk">
                      {canLog ? <td className="px-3 py-1.5"><Check label={`Select every port on ${panel}`} checked={on} indeterminate={!on && some} onChange={(x) => t.toggle(ids, x)} /></td> : null}
                      <td colSpan={12} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        {panel} <span className="font-normal normal-case">· {list.length} ports · {list.filter((r) => v(r, "test_result") === "passed").length} passed{canLog ? " · tick the box to select the whole panel" : ""}</span>
                      </td>
                    </tr>
                  ) : null}
                  {list.map((r) => (
                    <tr key={r.id} className={cn("border-b border-line align-middle last:border-0 hover:bg-panel-sunk/60", t.selected.has(r.id) && "bg-panel-sunk")}>
                      {canLog ? <td className="px-3 py-1"><Check label={`Select ${name(r)}`} checked={t.selected.has(r.id)} onChange={(x) => t.toggle([r.id], x)} /></td> : null}
                      <td className="px-1 py-1" title={deckLabel(v(r, "deck")) ?? undefined}>{cell(r, "deck", "Deck", { list: "dl-decks", width: "w-16" })}</td>
                      <td className="px-1 py-1">{cell(r, "room", "Room / area", { list: "dl-rooms", width: "w-32" })}</td>
                      <td className="px-1 py-1">{cell(r, "cable_type", "Cable type", { list: "dl-cable-types", width: "w-20" })}</td>
                      <td className="whitespace-nowrap px-2 py-1">{r.patch_panel} · {r.port}</td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1">
                          {cell(r, "label", "Cable no.", { width: "w-28" })}
                          <Link href={`${base}/site/cables/${r.id}`} className="text-xs text-ink-muted hover:underline" aria-label={`Open ${name(r)}`}>Open</Link>
                        </div>
                      </td>
                      <td className="px-1 py-1">{cell(r, "location", "Location", { width: "w-32" })}</td>
                      <td className="px-1 py-1">{cell(r, "system", "System", { list: "dl-systems", width: "w-20" })}</td>
                      <td className="px-1 py-1">{cell(r, "device_name", "Device", { width: "w-36" })}</td>
                      <td className="px-1 py-1">{cell(r, "switch_port", "Switch port", { width: "w-24" })}</td>
                      <td className="px-1 py-1"><EditCell value={len(r)} label={`Length for ${name(r)}`} disabled={!canLog} width="w-16" mono onSave={(x) => setLength(r, x)} /></td>
                      <td className="px-2 py-1">{resultControl(r)}</td>
                      <td className="min-w-44 px-1 py-1 text-xs text-ink-muted">{testedBy(r)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ devices

export type DeviceRow = {
  id: string; deck: string | null; room: string | null; location: string | null; system: string | null; type: string | null; name: string;
  manufacturer: string | null; model: string | null; ip: string | null; mac: string | null; serial: string | null; poe_w: number | null;
  switch_port: string | null; patch_panel: string | null; patch_port: number | null; status: string;
};
const DEVICE_BULK: [string, string, string?][] = [["room", "Room / area", "dl-rooms"], ["deck", "Deck", "dl-decks"], ["location", "Location"], ["manufacturer", "Manufacturer", "dl-manufacturers"], ["model", "Model"], ["type", "Type", "dl-types"], ["system", "System", "dl-systems"]];

/** Device list: type into any cell, pick a status, change many at once, remove. */
export function DeviceTable({ rows, base, canLog, canEdit }: { rows: DeviceRow[]; base: string; canLog: boolean; canEdit: boolean }) {
  const t = useEditable();
  const [bulk, setBulk] = useState("installed");
  const v = <K extends keyof DeviceRow>(r: DeviceRow, k: K) => t.get<DeviceRow[K]>(r.id, k as string, r[k]);
  const saveFields = (ids: string[], fields: Record<string, string | null>, after?: () => void) => t.save(ids, fields, () => updateDevices({ ids, fields }), after);
  const setStatus = (ids: string[], s: string, after?: () => void) => t.save(ids, { status: s }, () => updateDevicesStatus({ ids, status: s }), after);
  const allIds = rows.map((r) => r.id);
  const allOn = allIds.length > 0 && allIds.every((id) => t.selected.has(id));
  const cell = (r: DeviceRow, k: "name" | "manufacturer" | "model" | "type" | "system" | "deck" | "room" | "location" | "ip" | "mac" | "serial", label: string, opts: { list?: string; width?: string; mono?: boolean } = {}) => (
    <EditCell value={v(r, k)} label={`${label} for ${r.name}`} disabled={!canLog} list={opts.list} width={opts.width} mono={opts.mono}
      onSave={(x) => { if (k === "name" && !x) { t.setMsg({ ok: false, text: "A device needs a name." }); return; } saveFields([r.id], { [k]: x }); }} />
  );
  const control = (r: DeviceRow) => {
    const s = v(r, "status");
    if (!canLog) return <Badge tone={ITEM_STATUS[s].tone}>{ITEM_STATUS[s].label}</Badge>;
    return (
      <select aria-label={`Status for ${r.name}`} value={s} disabled={t.pending} onChange={(e) => setStatus([r.id], e.target.value)}
        className={cn("h-8 w-32 rounded-md border px-1.5 text-xs font-medium", toneSelect[ITEM_STATUS[s].tone])}>
        {Object.entries(ITEM_STATUS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
      </select>
    );
  };

  return (
    <div>
      {canLog ? (
        <BulkBar count={t.selected.size} fields={DEVICE_BULK} onClear={t.clear} msg={t.msg} pending={t.pending}
          hint="Click any cell to type in it (Enter saves, Esc cancels). Tick rows to set a common room, deck, manufacturer or status."
          onSetField={(f, x) => saveFields([...t.selected], { [f]: x }, t.clear)}>
          <label className="flex items-center gap-1.5">Status
            <select value={bulk} onChange={(e) => setBulk(e.target.value)} className={cn("h-8 rounded-md border px-1.5 text-xs font-medium", toneSelect[ITEM_STATUS[bulk].tone])}>
              {Object.entries(ITEM_STATUS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={t.pending} className={buttonClass("primary", "sm")} onClick={() => setStatus([...t.selected], bulk, t.clear)}>Apply</button>
          {canEdit ? (
            <button type="button" disabled={t.pending} className="text-danger underline"
              onClick={() => { if (window.confirm(`Remove ${t.selected.size} device${t.selected.size === 1 ? "" : "s"} from the project?`)) t.save([...t.selected], {}, () => removeSiteRows({ table: "site_devices", ids: [...t.selected] }), t.clear); }}>Remove</button>
          ) : null}
        </BulkBar>
      ) : null}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-3 px-4 py-3">
            {canLog ? <div className="pt-2"><Check label={`Select ${r.name}`} checked={t.selected.has(r.id)} onChange={(on) => t.toggle([r.id], on)} /></div> : null}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <label className="text-ink-muted">Deck{cell(r, "deck", "Deck", { list: "dl-decks" })}</label>
                <label className="text-ink-muted">Room / area{cell(r, "room", "Room", { list: "dl-rooms" })}</label>
              </div>
              <Link href={`${base}/site/devices/${r.id}`} className="block font-medium">{v(r, "name")}</Link>
              <p className="text-xs text-ink-muted">{[v(r, "manufacturer"), v(r, "model"), v(r, "type"), v(r, "ip")].filter(Boolean).join(" · ")}</p>
              <div className="pt-1">{control(r)}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[1300px] text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            {canLog ? <th className="w-8 px-3 py-2"><Check label="Select all on this page" checked={allOn} indeterminate={!allOn && allIds.some((id) => t.selected.has(id))} onChange={(on) => t.toggle(allIds, on)} /></th> : null}
            {["Deck", "Room / area", "Device", "Manufacturer", "Model", "Type", "System", "Location", "Patch panel · port", "IP", "MAC", "Serial", "Status"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-line align-middle last:border-0 hover:bg-panel-sunk/60", t.selected.has(r.id) && "bg-panel-sunk")}>
                {canLog ? <td className="px-3 py-1"><Check label={`Select ${r.name}`} checked={t.selected.has(r.id)} onChange={(x) => t.toggle([r.id], x)} /></td> : null}
                <td className="px-1 py-1" title={deckLabel(v(r, "deck")) ?? undefined}>{cell(r, "deck", "Deck", { list: "dl-decks", width: "w-16" })}</td>
                <td className="px-1 py-1">{cell(r, "room", "Room / area", { list: "dl-rooms", width: "w-32" })}</td>
                <td className="px-1 py-1">
                  <div className="flex items-center gap-1">{cell(r, "name", "Name", { width: "w-44" })}<Link href={`${base}/site/devices/${r.id}`} className="text-xs text-ink-muted hover:underline">Open</Link></div>
                </td>
                <td className="px-1 py-1">{cell(r, "manufacturer", "Manufacturer", { list: "dl-manufacturers", width: "w-28" })}</td>
                <td className="px-1 py-1">{cell(r, "model", "Model", { width: "w-32" })}</td>
                <td className="px-1 py-1">{cell(r, "type", "Type", { list: "dl-types", width: "w-28" })}</td>
                <td className="px-1 py-1">{cell(r, "system", "System", { list: "dl-systems", width: "w-20" })}</td>
                <td className="px-1 py-1">{cell(r, "location", "Location", { width: "w-28" })}</td>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{r.patch_panel ? `${r.patch_panel} · ${r.patch_port}` : r.switch_port ?? "—"}</td>
                <td className="px-1 py-1">{cell(r, "ip", "IP", { width: "w-28", mono: true })}</td>
                <td className="px-1 py-1">{cell(r, "mac", "MAC", { width: "w-36", mono: true })}</td>
                <td className="px-1 py-1">{cell(r, "serial", "Serial", { width: "w-28" })}</td>
                <td className="px-2 py-1">{control(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ switch ports

export type PortRow = {
  id: string; port: string; vlan: string | null; patch_port: string | null; end_location: string | null;
  end_device: string | null; poe_w: number | null; end_ip: string | null; notes: string | null;
};
const PORT_BULK: [string, string, string?][] = [["vlan", "VLAN", "dl-vlans"], ["end_location", "Location", "dl-rooms"], ["end_device", "End device"], ["patch_port", "Patch port"], ["notes", "Notes"]];

/** A switch's ports: type into any cell, set a common VLAN or location across many, remove. */
export function PortTable({ rows, canLog, canEdit }: { rows: PortRow[]; canLog: boolean; canEdit: boolean }) {
  const t = useEditable();
  const v = <K extends keyof PortRow>(r: PortRow, k: K) => t.get<PortRow[K]>(r.id, k as string, r[k]);
  const saveFields = (ids: string[], fields: Record<string, string | null>, after?: () => void) => t.save(ids, fields, () => updatePorts({ ids, fields }), after);
  const setPoe = (r: PortRow, raw: string | null) => {
    const n = raw === null ? null : Number(raw.replace(",", ".").replace(/\s*w$/i, ""));
    if (n !== null && (!Number.isFinite(n) || n < 0)) { t.setMsg({ ok: false, text: "PoE must be a number of watts." }); return; }
    t.save([r.id], { poe_w: n }, () => updatePorts({ ids: [r.id], poe_w: n }));
  };
  const allIds = rows.map((r) => r.id);
  const allOn = allIds.length > 0 && allIds.every((id) => t.selected.has(id));
  const cell = (r: PortRow, k: "port" | "vlan" | "patch_port" | "end_location" | "end_device" | "end_ip" | "notes", label: string, opts: { list?: string; width?: string; mono?: boolean } = {}) => (
    <EditCell value={v(r, k)} label={`${label} for ${r.port}`} disabled={!canLog} list={opts.list} width={opts.width} mono={opts.mono}
      onSave={(x) => { if (k === "port" && !x) { t.setMsg({ ok: false, text: "A port needs a name." }); return; } saveFields([r.id], { [k]: x }); }} />
  );
  const poe = (r: PortRow) => { const x = v(r, "poe_w"); return x === null ? null : String(Number(x)); };

  return (
    <div>
      {canLog ? (
        <BulkBar count={t.selected.size} fields={PORT_BULK} onClear={t.clear} msg={t.msg} pending={t.pending}
          hint="Click any cell to type in it (Enter saves, Esc cancels). Tick ports to set a common VLAN, location or device."
          onSetField={(f, x) => saveFields([...t.selected], { [f]: x }, t.clear)}>
          {canEdit ? (
            <button type="button" disabled={t.pending} className="text-danger underline"
              onClick={() => { if (window.confirm(`Remove ${t.selected.size} port${t.selected.size === 1 ? "" : "s"}?`)) t.save([...t.selected], {}, () => removeSwitchRows({ kind: "ports", ids: [...t.selected] }), t.clear); }}>Remove</button>
          ) : null}
        </BulkBar>
      ) : null}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-3 px-4 py-3">
            {canLog ? <div className="pt-2"><Check label={`Select ${r.port}`} checked={t.selected.has(r.id)} onChange={(on) => t.toggle([r.id], on)} /></div> : null}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">{r.port}</p>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <label className="text-ink-muted">VLAN{cell(r, "vlan", "VLAN", { list: "dl-vlans" })}</label>
                <label className="text-ink-muted">Location{cell(r, "end_location", "Location", { list: "dl-rooms" })}</label>
                <label className="col-span-2 text-ink-muted">End device{cell(r, "end_device", "End device")}</label>
                <label className="text-ink-muted">IP{cell(r, "end_ip", "IP", { mono: true })}</label>
                <label className="text-ink-muted">PoE (W)<EditCell value={poe(r)} label={`PoE for ${r.port}`} disabled={!canLog} mono onSave={(x) => setPoe(r, x)} /></label>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[1000px] text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            {canLog ? <th className="w-8 px-3 py-2"><Check label="Select every port" checked={allOn} indeterminate={!allOn && allIds.some((id) => t.selected.has(id))} onChange={(on) => t.toggle(allIds, on)} /></th> : null}
            {["Port", "VLAN", "Patch port", "Location", "End device", "PoE (W)", "IP", "Notes"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-line align-middle last:border-0 hover:bg-panel-sunk/60", t.selected.has(r.id) && "bg-panel-sunk", !v(r, "end_device") && "text-ink-muted")}>
                {canLog ? <td className="px-3 py-1"><Check label={`Select ${r.port}`} checked={t.selected.has(r.id)} onChange={(x) => t.toggle([r.id], x)} /></td> : null}
                <td className="px-1 py-1 font-medium">{cell(r, "port", "Port name", { width: "w-24" })}</td>
                <td className="px-1 py-1">{cell(r, "vlan", "VLAN", { list: "dl-vlans", width: "w-16" })}</td>
                <td className="px-1 py-1">{cell(r, "patch_port", "Patch port", { width: "w-28" })}</td>
                <td className="px-1 py-1">{cell(r, "end_location", "Location", { list: "dl-rooms", width: "w-24" })}</td>
                <td className="px-1 py-1">{cell(r, "end_device", "End device", { width: "w-52" })}</td>
                <td className="px-1 py-1"><EditCell value={poe(r)} label={`PoE for ${r.port}`} disabled={!canLog} width="w-16" mono onSave={(x) => setPoe(r, x)} /></td>
                <td className="px-1 py-1">{cell(r, "end_ip", "IP", { width: "w-32", mono: true })}</td>
                <td className="px-1 py-1">{cell(r, "notes", "Notes", { width: "w-40" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
