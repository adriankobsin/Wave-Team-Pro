"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Section tick boxes and the download button for the project pack. */
export function ExportForm({ action, sections }: { action: string; sections: { key: string; label: string; info: string; empty: boolean; defaultOn: boolean }[] }) {
  const [on, setOn] = useState(() => new Set(sections.filter((s) => s.defaultOn).map((s) => s.key)));
  const [busy, setBusy] = useState(false);
  const href = `${action}?s=${[...on].join(",")}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="underline" onClick={() => setOn(new Set(sections.filter((s) => !s.empty).map((s) => s.key)))}>Tick everything</button>
        <button type="button" className="underline" onClick={() => setOn(new Set())}>Untick everything</button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sections.map((s) => (
          <li key={s.key}>
            <label className={cn("flex h-full cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-panel-sunk", on.has(s.key) && "border-brass bg-brass-soft/40", s.empty && "opacity-60")}>
              <input type="checkbox" className="mt-0.5 size-5" checked={on.has(s.key)} onChange={(e) => setOn((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.key); else n.delete(s.key); return n; })} />
              <span><span className="block font-medium">{s.label}</span><span className="block text-xs text-ink-muted">{s.empty ? "Nothing here yet" : s.info}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <a href={on.size ? href : undefined} aria-disabled={!on.size} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 15000); }}
          className={cn(buttonClass("primary"), !on.size && "pointer-events-none opacity-50")}>{busy ? "Preparing the PDF…" : "Download project pack (PDF)"}</a>
        <span className="text-sm text-ink-muted">{busy ? "Large drawings can take up to a minute; the download starts by itself." : `${on.size} of ${sections.length} sections`}</span>
      </div>
    </div>
  );
}
