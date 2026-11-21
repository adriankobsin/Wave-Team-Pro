import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject, siteSuggestions } from "@/server/services/site";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { PortTable, Suggestions, type PortRow } from "@/components/site/edit-tables";
import { AddPorts, AddSwitch, SwitchDetails, SwitchPicker, type EquipmentRow } from "@/components/site/switch-forms";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Switches" };

export default async function SwitchesPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ eq?: string }> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { canEdit, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const [{ data: equipment }, { data: counts }, { data: vlans }, suggestions] = await Promise.all([
    supabase.from("site_equipment").select("id, sheet, title, hostname, model, mac, serial, firmware, location, ip, poe_total_w").eq("project_id", id).is("archived_at", null).order("sheet"),
    supabase.from("site_ports").select("equipment, end_device, poe_w").eq("project_id", id).is("archived_at", null).limit(5000),
    supabase.from("site_vlans").select("vlan_id, name").eq("project_id", id).is("archived_at", null).order("vlan_id"),
    siteSuggestions(id),
  ]);
  const eqs = (equipment ?? []) as EquipmentRow[];
  const current = eqs.find((e) => e.sheet === sp.eq) ?? eqs[0];
  const { data: ports } = current ? await supabase.from("site_ports").select("id, port, vlan, patch_port, end_location, end_device, poe_w, end_ip, notes").eq("project_id", id).eq("equipment", current.sheet).is("archived_at", null).order("position").order("port") : { data: [] };
  const used = (s: string) => (counts ?? []).filter((p) => p.equipment === s && p.end_device).length;
  const poe = (s: string) => (counts ?? []).filter((p) => p.equipment === s).reduce((n, p) => n + Number(p.poe_w ?? 0), 0);

  return (
    <div className="space-y-4">
      <Suggestions lists={{ ...suggestions, "dl-vlans": (vlans ?? []).map((v) => [String(v.vlan_id), v.name as string] as [string, string]) }} />
      <PageHeader title="Switches, router, firewall and PBX" description="Port by port: VLAN, patch panel port, what's plugged in and its IP, with PoE use against each switch's budget. Click any cell to change it."
        actions={canEdit ? <a href={`${base}/site/export?kind=ports`} className={buttonClass("secondary", "sm")}>Excel</a> : undefined} />
      {canLog ? <AddSwitch projectId={id} /> : null}
      {eqs.length ? (
        <div className="grid gap-4 2xl:grid-cols-[260px_minmax(0,1fr)]">
          {current ? (
            <div className="2xl:hidden">
              <SwitchPicker current={current.sheet} options={eqs.map((e) => {
                const load = poe(e.sheet); const budget = Number(e.poe_total_w ?? 0);
                return [e.sheet, [e.sheet, e.model, e.ip, `${used(e.sheet)} in use`, budget ? `PoE ${Math.round(load)}/${budget} W${load > budget ? " OVER" : ""}` : null].filter(Boolean).join(" · ")] as [string, string];
              })} />
            </div>
          ) : null}
          <Panel className="hidden h-fit 2xl:block">
            <ul className="divide-y divide-line text-sm 2xl:max-h-[75dvh] 2xl:overflow-y-auto">
              {eqs.map((e) => {
                const load = poe(e.sheet); const budget = Number(e.poe_total_w ?? 0);
                return (
                  <li key={e.id}><Link href={`?eq=${encodeURIComponent(e.sheet)}`} className={cn("block px-4 py-2.5", current?.id === e.id ? "bg-panel-sunk font-semibold" : "hover:bg-panel-sunk")}>
                    {e.sheet}
                    <span className="block text-xs font-normal text-ink-muted">{[e.model, e.ip].filter(Boolean).join(" · ")} · {used(e.sheet)} in use{budget ? ` · PoE ${Math.round(load)}/${budget} W` : ""}</span>
                    {budget && load > budget ? <span className="block text-xs font-semibold text-danger">PoE over budget</span> : null}
                  </Link></li>
                );
              })}
            </ul>
          </Panel>
          {current ? (
            <Panel className="overflow-hidden">
              <PanelHeader title={current.sheet} description={[current.title, current.hostname, current.model, current.ip ? `Management ${current.ip}` : null, current.firmware ? `Firmware ${current.firmware}` : null, current.serial ? `S/N ${current.serial}` : null, current.location].filter(Boolean).join(" · ")} />
              <SwitchDetails key={current.id} eq={current} canLog={canLog} canEdit={canEdit} />
              {(ports ?? []).length ? <PortTable rows={(ports ?? []) as PortRow[]} canLog={canLog} canEdit={canEdit} /> : <EmptyState title="No ports yet">{canLog ? "Add them below." : "Nothing recorded for this switch."}</EmptyState>}
              {canLog ? <AddPorts projectId={id} sheet={current.sheet} /> : null}
            </Panel>
          ) : null}
        </div>
      ) : <Panel><EmptyState title="No switches yet">Import the network spreadsheet on the Site page, or add one above.</EmptyState></Panel>}
    </div>
  );
}
