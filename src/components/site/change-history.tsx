import { Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";
import type { Change } from "@/server/services/site";

const LABEL: Record<string, string> = {
  test_result: "Test", length_m: "Length (m)", tested_on: "Tested on", tested_by: "Tested by", tested_by_ids: "Tested by", tested_by_name: "Tested by", label: "Label", cable_type: "Cable type",
  room: "Room", location: "Location", device_name: "Device", switch_port: "Switch port", notes: "Notes", installed: "Installed", status: "Status",
  status_by: "Status by", status_at: "Status at", dali_address: "DALI address", driver: "Driver", engraving: "Engraving", component_name: "Name", ip: "IP",
  mac: "MAC", serial: "Serial", model: "Model", firmware: "Firmware", name: "Name", device_id: "Linked device", zone_href: "Lutron zone",
};
const HIDE = new Set(["status_by", "status_at", "tested_by_name", "device_id", "archived_at"]);

/** Who changed what and when, newest first. */
export function ChangeHistory({ changes, names, tz, people }: { changes: Change[]; names: Map<string, string>; tz: string; people?: Map<string, string> }) {
  const show = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k === "tested_by" && typeof v === "string") return people?.get(v) ?? names.get(v) ?? "someone";
    if (k === "tested_by_ids" && Array.isArray(v)) return v.length ? v.map((u) => people?.get(String(u)) ?? names.get(String(u)) ?? "someone").join(", ") : "—";
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v).replaceAll("_", " ");
  };
  return (
    <Panel>
      <PanelHeader title="History" description="Every change, with who made it and when." />
      {changes.length ? (
        <ol className="divide-y divide-line text-sm">
          {changes.map((c) => {
            const rows = Object.entries(c.changes).filter(([k]) => !HIDE.has(k) && !(k === "tested_by" && "tested_by_ids" in c.changes));
            if (!rows.length) return null;
            return (
              <li key={c.id} className="px-4 py-2.5 sm:px-5">
                <p className="text-xs text-ink-muted">{formatDateTime(c.changed_at, tz)} · {c.changed_by ? names.get(c.changed_by) ?? "Someone" : "Import"}</p>
                <ul className="mt-0.5">
                  {rows.map(([k, [a, b]]) => <li key={k}><span className="text-ink-muted">{LABEL[k] ?? k}:</span> {show(k, a)} → <span className="font-medium">{show(k, b)}</span></li>)}
                </ul>
              </li>
            );
          })}
        </ol>
      ) : <p className="p-4 text-sm text-ink-muted sm:p-5">No changes yet.</p>}
    </Panel>
  );
}
