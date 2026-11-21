import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DECKS, ITEM_STATUS, PAGE_SIZE, getSiteProject, siteSuggestions } from "@/server/services/site";
import { Pager } from "@/components/site/site-nav";
import { DeviceTable, Suggestions, type DeviceRow } from "@/components/site/edit-tables";
import { AddDevice } from "@/components/site/add-device";
import { EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Devices" };
type Sp = { q?: string; deck?: string; system?: string; type?: string; status?: string; page?: string };

export default async function DevicesPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<Sp> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { canEdit, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  let q = supabase.from("site_devices").select("id, deck, room, location, system, type, name, manufacturer, model, ip, mac, serial, poe_w, switch_port, patch_panel, patch_port, status", { count: "exact" }).eq("project_id", id).is("archived_at", null);
  if (sp.deck) q = q.eq("deck", sp.deck);
  if (sp.system) q = q.eq("system", sp.system);
  if (sp.type) q = q.eq("type", sp.type);
  if (sp.status && sp.status in ITEM_STATUS) q = q.eq("status", sp.status);
  const text = (sp.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (text) q = q.or(`name.ilike.%${text}%,manufacturer.ilike.%${text}%,ip.ilike.%${text}%,mac.ilike.%${text}%,serial.ilike.%${text}%,room.ilike.%${text}%,location.ilike.%${text}%,model.ilike.%${text}%`);
  const [{ data, count }, { data: facets }, suggestions] = await Promise.all([
    q.order("deck").order("room").order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("site_devices").select("deck, system, type").eq("project_id", id).is("archived_at", null).limit(5000),
    siteSuggestions(id),
  ]);
  const rows = data ?? [];
  const uniq = (k: "deck" | "system" | "type") => [...new Set((facets ?? []).map((f) => f[k] as string | null).filter((x): x is string => Boolean(x)))].sort();
  const params2 = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && v)) as Record<string, string>;
  const select = "mt-1 block h-9 rounded-md border border-line bg-panel px-2";

  return (
    <div className="space-y-4">
      <PageHeader title="Devices" description="Every network, AV, phone, security and control device. Click any cell to type in it; it saves when you press Enter or click away. Tick devices to give them a common room, deck, manufacturer or status. “Add a device” puts in anything not in the spreadsheet." actions={canEdit ? <a href={`${base}/site/export?kind=devices`} className={buttonClass("secondary", "sm")}>Excel</a> : undefined} />
      <Suggestions lists={suggestions} />
      {canLog ? <AddDevice projectId={id} /> : null}
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label>Search<input name="q" defaultValue={sp.q} placeholder="Name, IP, MAC, serial…" className={cn(select, "w-48")} /></label>
        <label>Deck<select name="deck" defaultValue={sp.deck ?? ""} className={select}><option value="">All</option>{uniq("deck").map((x) => <option key={x} value={x}>{DECKS[x] ?? x}</option>)}</select></label>
        <label>System<select name="system" defaultValue={sp.system ?? ""} className={select}><option value="">All</option>{uniq("system").map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Type<select name="type" defaultValue={sp.type ?? ""} className={select}><option value="">All</option>{uniq("type").map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={sp.status ?? ""} className={select}><option value="">Any</option>{Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <button type="submit" className={buttonClass("secondary", "sm")}>Show</button>
      </form>
      <Panel className="overflow-hidden">
        {rows.length ? (
          <>
            <DeviceTable rows={rows as DeviceRow[]} base={base} canLog={canLog} canEdit={canEdit} />
            <Pager page={page} total={count ?? 0} size={PAGE_SIZE} params={params2} />
          </>
        ) : <EmptyState title="No devices">Nothing matches, or no network spreadsheet has been imported yet (Site → Import).</EmptyState>}
      </Panel>
    </div>
  );
}
