"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Options and download button for the client handover document. */
export function HandoverForm({ action, count, systems, defaultClient }: { action: string; count: number; systems: { code: string; name: string; count: number }[]; defaultClient: string }) {
  const [by, setBy] = useState<"system" | "area">("system");
  const [tick, setTick] = useState(false);
  const [client, setClient] = useState(defaultClient);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string[]>(["installation"]);
  const [off, setOff] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>(() => systems.map((x) => x.code));
  const toggle = (list: string[], set: (v: string[]) => void, k: string) => set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const items = systems.filter((x) => picked.includes(x.code)).reduce((n, x) => n + x.count, 0);
  const all = picked.length === systems.length;
  const qs = [`by=${by}`, `tick=${tick ? 1 : 0}`, `client=${encodeURIComponent(client)}`, ...scope.map((k) => `scope=${k}`), ...off.map((k) => `off=${k}`), ...(all ? [] : picked.map((c) => `sys=${encodeURIComponent(c)}`))].join("&");
  const href = `${action}?${qs}`;
  const SCOPES: [string, string][] = [["installation", "Installation"], ["check", "System check"], ["commissioning", "Commissioning"], ["programming", "Programming"], ["support", "Technical support"]];
  const PARTS: [string, string][] = [["equipment", "Equipment list with serial numbers"], ["function", "What each system does"], ["tick", "Tick boxes for each item"], ["checks", "Functional checks"], ["remarks", "Remarks / outstanding items lines"], ["sign", "Client signature and date blocks"], ["final", "Final acceptance page"]];
  const box = (checked: boolean, onChange: () => void, text: string, extra?: string) => (
    <label key={text} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-panel-sunk">
      <input type="checkbox" className="size-5" checked={checked} onChange={onChange} /><span>{text}</span>{extra ? <span className="ml-auto text-xs text-ink-muted">{extra}</span> : null}
    </label>
  );
  const opt = (v: "system" | "area", title: string, info: string) => (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-panel-sunk", by === v && "border-brass bg-brass-soft/40")}>
      <input type="radio" name="by" className="mt-0.5 size-5" checked={by === v} onChange={() => setBy(v)} />
      <span><span className="block font-medium">{title}</span><span className="block text-xs text-ink-muted">{info}</span></span>
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {opt("system", "One sign-off per system", "CCTV, Wi-Fi, audio-video… each with what it does, its checklist and a signature block")}
        {opt("area", "One sign-off per area", "Each deck and room, with all its systems together. A longer document.")}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What does this handover cover?</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{SCOPES.map(([k, t]) => box(scope.includes(k), () => toggle(scope, setScope, k), t))}</div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Systems to include</legend>
        <div className="flex gap-3 text-xs"><button type="button" className="underline" onClick={() => setPicked(systems.map((x) => x.code))}>Tick all</button><button type="button" className="underline" onClick={() => setPicked([])}>Untick all</button></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{systems.map((x) => box(picked.includes(x.code), () => toggle(picked, setPicked, x.code), x.name, String(x.count)))}</div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What to print</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PARTS.map(([k, t]) => box(!off.includes(k), () => toggle(off, setOff, k), t))}</div>
      </fieldset>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-panel-sunk">
        <input type="checkbox" className="mt-0.5 size-5" checked={tick} onChange={(e) => setTick(e.target.checked)} />
        <span><span className="block font-medium">Pre-tick the boxes from the recorded status</span><span className="block text-xs text-ink-muted">Installed is ticked for installed, commissioned and tested items; Working for commissioned and tested. Leave it off to print blank boxes to tick together with the client.</span></span>
      </label>
      <label className="block max-w-md text-sm">
        <span className="mb-1 block font-medium">Client name (for the signature blocks)</span>
        <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} placeholder="e.g. the owner, the yacht or the company" className="w-full rounded-lg border border-line bg-panel px-3 py-2" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <a href={items ? href : undefined} aria-disabled={!items} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 15000); }} className={cn(buttonClass("primary"), !items && "pointer-events-none opacity-50")}>
          {busy ? "Preparing the PDF…" : "Download handover document (PDF)"}
        </a>
        <span className="text-sm text-ink-muted">{!count ? "Add devices on the Devices page first" : items ? `${items} items in ${picked.length} ${picked.length === 1 ? "system" : "systems"}` : "Tick at least one system"}</span>
      </div>
    </div>
  );
}
