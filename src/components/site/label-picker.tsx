"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Item = { key: string; title: string; detail: string };
type Group = { id: string; title: string; hint: string; items: Item[] };

/** Tick what to label, pick the sticker sheet, open the printable PDF. */
export function LabelPicker({ action, groups, sheets, preselect }: { action: string; groups: Group[]; sheets: { key: string; name: string }[]; preselect: string }) {
  const [on, setOn] = useState(() => new Set(groups.find((g) => g.id === preselect)?.items.map((i) => i.key) ?? []));
  const [sheet, setSheet] = useState(preselect === "racks" ? "large" : "small");
  const [copies, setCopies] = useState(1);
  const toggle = (keys: string[], v: boolean) => setOn((cur) => { const n = new Set(cur); for (const k of keys) { if (v) n.add(k); else n.delete(k); } return n; });
  const href = `${action}?${new URLSearchParams([["sheet", sheet], ["copies", String(copies)], ...[...on].map((k) => ["i", k])]).toString()}`;
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const keys = g.items.map((i) => i.key);
        const all = keys.every((k) => on.has(k));
        return (
          <section key={g.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{g.title} <span className="text-sm font-normal text-ink-muted">({g.items.length})</span></h3>
              <button type="button" className="text-sm underline" onClick={() => toggle(keys, !all)}>{all ? "Untick all" : "Tick all"}</button>
            </div>
            <p className="text-xs text-ink-muted">{g.hint}</p>
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((i) => (
                <li key={i.key}>
                  <label className={cn("flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 text-sm hover:bg-panel-sunk", on.has(i.key) && "border-brass bg-brass-soft/40")}>
                    <input type="checkbox" className="mt-0.5 size-4" checked={on.has(i.key)} onChange={(e) => toggle([i.key], e.target.checked)} />
                    <span className="min-w-0"><span className="block truncate font-medium">{i.title}</span>{i.detail ? <span className="block truncate text-xs text-ink-muted">{i.detail}</span> : null}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="text-sm">Sticker sheet
          <select value={sheet} onChange={(e) => setSheet(e.target.value)} className="mt-1 block h-9 max-w-[22rem] rounded-md border border-line bg-panel px-2">
            {sheets.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Copies of each
          <select value={copies} onChange={(e) => setCopies(Number(e.target.value))} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <a href={on.size ? href : undefined} target="_blank" rel="noopener" aria-disabled={!on.size} className={cn(buttonClass("primary"), !on.size && "pointer-events-none opacity-50")}>Open labels to print ({on.size * copies})</a>
      </div>
      <p className="text-xs text-ink-muted">Print at 100% (“Actual size”, not “Fit to page”) so the stickers line up with the sheet.</p>
    </div>
  );
}
