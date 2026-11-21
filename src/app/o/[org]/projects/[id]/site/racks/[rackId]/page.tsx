import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject, siteSuggestions } from "@/server/services/site";
import { Suggestions } from "@/components/site/edit-tables";
import { RackEditor, type RackDevice, type RackItem } from "@/components/site/rack-editor";
import { rackCode, rackRoom } from "@/server/services/labels";
import { Panel, PanelHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Rack" };

export default async function RackPage({ params }: { params: Promise<{ org: string; id: string; rackId: string }> }) {
  const { org, id, rackId } = await params;
  if (!z.uuid().safeParse(rackId).success) notFound();
  const { base, canLog, canEdit } = await getSiteProject(org, id);
  const supabase = await createClient();
  const [{ data: rack }, { data: racks }, { data: items }, { data: devices }, { data: placed }, suggestions] = await Promise.all([
    supabase.from("site_racks").select("id, name, units, location").eq("id", rackId).eq("project_id", id).is("archived_at", null).maybeSingle(),
    supabase.from("site_racks").select("id, name").eq("project_id", id).is("archived_at", null).order("name"),
    supabase.from("site_rack_items").select("id, u_bottom, u_size, kind, label, manufacturer, model, device_id, notes").eq("rack_id", rackId).order("u_bottom"),
    supabase.from("site_devices").select("id, name, type, manufacturer, model, room").eq("project_id", id).is("archived_at", null).order("name").limit(3000),
    supabase.from("site_rack_items").select("device_id, site_racks(name)").eq("project_id", id).not("device_id", "is", null),
    siteSuggestions(id),
  ]);
  if (!rack) notFound();
  // What an engineer at this rack needs next: its patch panels and the switches in the same room.
  const code = rackCode(rack.name as string), room = rackRoom(rack.name as string);
  const [{ data: cables }, { data: eq }, { data: ports }] = await Promise.all([
    supabase.from("site_cables").select("patch_panel, label, test_result").eq("project_id", id).is("archived_at", null).ilike("patch_panel", `%${code.replace(/[%_\\]/g, "")}%`).limit(2000),
    room ? supabase.from("site_equipment").select("sheet, title, model, location").eq("project_id", id).is("archived_at", null).or(`sheet.ilike.%${room}%,location.ilike.%${room}%`).order("sheet") : Promise.resolve({ data: [] as { sheet: string; title: string | null; model: string | null; location: string | null }[] }),
    supabase.from("site_ports").select("equipment, end_device").eq("project_id", id).is("archived_at", null).limit(5000),
  ]);
  const panels = [...new Set((cables ?? []).map((c) => c.patch_panel as string))].sort();
  const where = new Map<string, string>();
  for (const p of placed ?? []) where.set(p.device_id as string, ((p.site_racks as unknown as { name: string } | null)?.name ?? "a rack").split(" - ")[0]);
  const list: RackDevice[] = (devices ?? []).map((d) => ({ ...(d as Omit<RackDevice, "placedIn">), placedIn: where.get(d.id as string) ?? null }));

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href={`${base}/site/racks`} className="underline">← All racks</Link></p>
      <Suggestions lists={suggestions} />
      <RackEditor projectId={id} rack={rack as { id: string; name: string; units: number; location: string | null }} items={(items ?? []) as RackItem[]}
        racks={(racks ?? []) as { id: string; name: string }[]} devices={list} canLog={canLog} canEdit={canEdit} backHref={`${base}/site/racks`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Patch panels in this rack" description={panels.length ? "Open a panel for its full schedule: ports, cable numbers, rooms, devices, test results." : `No patch panels named with ${code} in the cable schedule.`} />
          <ul className="divide-y divide-line">
            {panels.map((p) => {
              const l = (cables ?? []).filter((c) => c.patch_panel === p);
              const used = l.filter((c) => c.label).length, passed = l.filter((c) => c.test_result === "passed").length;
              return (
                <li key={p}><Link href={`${base}/site/cables?panel=${encodeURIComponent(p)}&all=1`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-panel-sunk sm:px-5">
                  <span className="font-medium">{p}</span>
                  <span className="text-right text-xs text-ink-muted">{used} cables · {passed}/{used || 0} passed</span>
                </Link></li>
              );
            })}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title={room ? `Switches and network equipment in room ${room}` : "Switches"} description="Open one for every port: VLAN, patch port, end device, PoE and IP." />
          <ul className="divide-y divide-line">
            {(eq ?? []).map((e) => {
              const l = (ports ?? []).filter((x) => x.equipment === e.sheet);
              return (
                <li key={e.sheet as string}><Link href={`${base}/site/switches?eq=${encodeURIComponent(e.sheet as string)}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-panel-sunk sm:px-5">
                  <span><span className="block font-medium">{e.sheet}</span><span className="block text-xs text-ink-muted">{[e.title, e.model].filter(Boolean).join(" · ")}</span></span>
                  <span className="text-right text-xs text-ink-muted">{l.filter((x) => x.end_device).length}/{l.length} ports in use</span>
                </Link></li>
              );
            })}
            {!(eq ?? []).length ? <li className="px-4 py-3 text-sm text-ink-muted sm:px-5">None found for this room.</li> : null}
          </ul>
        </Panel>
      </div>
      <p className="text-sm"><Link href={`${base}/labels?pick=racks`} className="underline">Print QR stickers for the racks</Link></p>
    </div>
  );
}
