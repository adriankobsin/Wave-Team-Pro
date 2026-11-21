"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { addPorts, addSwitch, removeSwitchRows, updateEquipment } from "@/server/actions/switches";

export type EquipmentRow = {
  id: string; sheet: string; title: string | null; hostname: string | null; model: string | null; mac: string | null; serial: string | null;
  firmware: string | null; location: string | null; ip: string | null; poe_total_w: number | null;
};

const FIELDS: [keyof EquipmentRow, string, string?][] = [
  ["sheet", "Name"], ["title", "Description"], ["hostname", "Hostname"], ["model", "Model"], ["ip", "Management IP"],
  ["mac", "MAC"], ["serial", "Serial"], ["firmware", "Firmware"], ["location", "Location", "dl-rooms"], ["poe_total_w", "PoE budget (W)"],
];

/** The selected switch's details, each one a field you can type into (saves on Enter or leaving it). */
export function SwitchDetails({ eq, canLog, canEdit }: { eq: EquipmentRow; canLog: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = (k: keyof EquipmentRow, raw: string) => {
    const x = raw.trim() || null;
    const before = eq[k] === null ? null : String(eq[k]);
    if (x === before) return;
    start(async () => {
      let r;
      if (k === "poe_total_w") {
        const n = x === null ? null : Number(x.replace(",", ".").replace(/\s*w$/i, ""));
        if (n !== null && (!Number.isFinite(n) || n < 0)) { setMsg({ ok: false, text: "PoE budget must be a number of watts." }); return; }
        r = await updateEquipment({ id: eq.id, poe_total_w: n });
      } else r = await updateEquipment({ id: eq.id, fields: { [k]: x } });
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
      if (r.ok) router.replace(k === "sheet" && x ? `?eq=${encodeURIComponent(x)}` : `?eq=${encodeURIComponent(eq.sheet)}`);
    });
  };
  if (!canLog) return null;
  return (
    <details className="border-b border-line">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">Edit switch details</summary>
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-5" key={eq.id}>
        {FIELDS.map(([k, label, list]) => (
          <label key={k} className="text-xs text-ink-muted">{label}
            <input defaultValue={eq[k] === null ? "" : String(eq[k])} list={list} disabled={pending}
              className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2 text-sm text-ink focus:border-brass focus:outline-none"
              onBlur={(e) => save(k, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3 text-sm">
        <span role="status" className={msg?.ok ? "text-ok" : "text-danger"}>{pending ? <span className="text-ink-muted">Saving…</span> : msg?.text}</span>
        {canEdit ? (
          <button type="button" className="ml-auto text-danger underline" disabled={pending}
            onClick={() => { if (window.confirm(`Remove ${eq.sheet} and all its ports?`)) start(async () => { const r = await removeSwitchRows({ kind: "switch", ids: [eq.id] }); setMsg(r.ok ? { ok: true, text: r.message ?? "Removed." } : { ok: false, text: r.error }); if (r.ok) router.replace("?"); }); }}>
            Remove this switch
          </button>
        ) : null}
      </div>
    </details>
  );
}

/** "Add ports" under the port table: one port or a numbered run. */
export function AddPorts({ projectId, sheet }: { projectId: string; sheet: string }) {
  return (
    <details className="border-t border-line">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">+ Add ports</summary>
      <ActionForm action={addPorts} resetOnSuccess className="grid items-end gap-3 px-4 pb-4 sm:grid-cols-5">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="sheet" value={sheet} />
        <TextField label="Name before the number" name="prefix" placeholder="Gi1/0/" maxLength={30} hint="e.g. Gi1/0/, Te1/1/, port " />
        <TextField label="First number" name="from" type="number" min={0} max={999} required defaultValue="1" />
        <TextField label="Last number" name="to" type="number" min={0} max={999} required defaultValue="1" />
        <TextField label="Digits" name="pad" type="number" min={1} max={3} defaultValue="1" hint="2 gives 01, 02…" />
        <SubmitButton pendingLabel="Adding…">Add ports</SubmitButton>
      </ActionForm>
    </details>
  );
}

/** "+ Add a switch" above the list: switches, routers, firewalls or PBX not in the spreadsheet. */
export function AddSwitch({ projectId }: { projectId: string }) {
  return (
    <details className="rounded-lg border border-line bg-panel">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">+ Add a switch, router, firewall or PBX</summary>
      <ActionForm action={addSwitch} resetOnSuccess className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="projectId" value={projectId} />
        <TextField label="Name" name="sheet" required maxLength={80} placeholder="LEC 403 Sw3" />
        <TextField label="Model" name="model" optional maxLength={120} placeholder="C9300L-24P-4X-E" />
        <TextField label="Hostname" name="hostname" optional maxLength={80} />
        <TextField label="Management IP" name="ip" optional maxLength={80} placeholder="192.168.10.7" />
        <TextField label="Location" name="location" optional maxLength={80} list="dl-rooms" placeholder="LEC 403" />
        <TextField label="PoE budget (W)" name="poe_total_w" optional type="number" min={0} max={100000} />
        <TextField label="Ports: name before the number" name="prefix" optional maxLength={30} placeholder="Gi1/0/" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="First port" name="portsFrom" optional type="number" min={0} max={999} placeholder="1" />
          <TextField label="Last port" name="portsTo" optional type="number" min={0} max={999} placeholder="24" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4"><SubmitButton pendingLabel="Adding…">Add switch</SubmitButton></div>
      </ActionForm>
    </details>
  );
}

/** On narrower screens: pick the switch from a list instead of the side column. */
export function SwitchPicker({ options, current }: { options: [string, string][]; current: string }) {
  const router = useRouter();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm font-medium">Switch
      <select value={current} onChange={(e) => router.push(`?eq=${encodeURIComponent(e.target.value)}`)}
        className="h-10 min-w-0 max-w-full flex-1 rounded-md border border-line bg-panel px-2 text-sm font-normal sm:max-w-xl">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
