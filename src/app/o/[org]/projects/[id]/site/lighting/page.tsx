import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { ITEM_STATUS, getSiteProject } from "@/server/services/site";
import { setLoadsStatus } from "@/server/actions/site";
import { Pager } from "@/components/site/site-nav";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lighting loads" };
type Sp = { q?: string; deck?: string; panel?: string; type?: string; status?: string; page?: string };
const SIZE = 200;

export default async function LightingPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<Sp> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { canEdit, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  let q = supabase.from("lighting_loads").select("id, area, zone_number, zone_name, load_number, fixture, quantity, load_type, panel, module, output, wattage, zone_href, dali_address, status", { count: "exact" }).eq("project_id", id).is("archived_at", null);
  if (sp.deck) q = q.like("area", `${sp.deck.replace(/[%_\\]/g, "")}%`);
  if (sp.panel) q = q.eq("panel", sp.panel);
  if (sp.type) q = q.eq("load_type", sp.type);
  if (sp.status && sp.status in ITEM_STATUS) q = q.eq("status", sp.status);
  const text = (sp.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (text) q = q.or(`area.ilike.%${text}%,zone_name.ilike.%${text}%,fixture.ilike.%${text}%,module.ilike.%${text}%`);
  const [{ data, count }, { data: facets }] = await Promise.all([
    q.order("area").order("zone_number").order("load_number").range((page - 1) * SIZE, page * SIZE - 1),
    supabase.from("lighting_loads").select("area, panel, load_type").eq("project_id", id).is("archived_at", null).limit(5000),
  ]);
  const rows = data ?? [];
  // Scanned from a lighting panel's QR sticker: show the panel at a glance — modules, outputs and power.
  const { data: panelLoads } = sp.panel
    ? await supabase.from("lighting_loads").select("module, output, wattage, load_type, status").eq("project_id", id).is("archived_at", null).eq("panel", sp.panel).limit(2000)
    : { data: null };
  const modules = new Map<string, { loads: number; outputs: Set<string>; watts: number; types: Set<string>; done: number }>();
  for (const l of panelLoads ?? []) {
    const k = (l.module as string) || "No module";
    const m = modules.get(k) ?? { loads: 0, outputs: new Set<string>(), watts: 0, types: new Set<string>(), done: 0 };
    m.loads += 1; if (l.output) m.outputs.add(l.output as string); m.watts += Number(l.wattage ?? 0); if (l.load_type) m.types.add(l.load_type as string);
    if (["commissioned", "tested"].includes(l.status as string)) m.done += 1;
    modules.set(k, m);
  }
  const decks = [...new Set((facets ?? []).map((f) => (f.area as string).split("\\")[0]))].sort();
  const panels = [...new Set((facets ?? []).map((f) => f.panel as string).filter(Boolean))].sort();
  const types = [...new Set((facets ?? []).map((f) => f.load_type as string).filter(Boolean))].sort();
  const byArea = new Map<string, typeof rows>();
  for (const r of rows) byArea.set(r.area as string, [...(byArea.get(r.area as string) ?? []), r]);
  const params2 = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && v)) as Record<string, string>;
  const select = "mt-1 block h-9 max-w-56 rounded-md border border-line bg-panel px-2";

  return (
    <div className="space-y-4">
      <PageHeader title="Lighting loads" description="Every load from the Lutron load schedule: DALI drivers, DMX, 0-10 V and motors, with the panel, module and loop, and the zone's integration address. Tick loads to update many at once." actions={canEdit ? <a href={`${base}/site/export?kind=loads`} className={buttonClass("secondary", "sm")}>Excel</a> : undefined} />
      {sp.panel && panelLoads ? (
        <Panel className="p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Lighting panel {sp.panel.split("\\").pop()}</h2>
            <span className="text-sm text-ink-muted">{sp.panel.split("\\")[0]} · {panelLoads.length} loads · {modules.size} modules · {Math.round([...modules.values()].reduce((n, m) => n + m.watts, 0))} W listed</span>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...modules.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([name, m]) => (
              <li key={name} className="rounded-md border border-line px-3 py-2 text-sm">
                <p className="font-medium">{name}</p>
                <p className="text-xs text-ink-muted">{m.loads} loads · {m.outputs.size} outputs · {Math.round(m.watts)} W · {m.done}/{m.loads} commissioned or tested</p>
                <p className="truncate text-xs text-ink-muted">{[...m.types].join(", ")}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm"><Link href="?" className="underline">Show every panel</Link> · <Link href={`${base}/labels?pick=lighting`} className="underline">Print QR stickers for the lighting panels</Link></p>
        </Panel>
      ) : null}
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label>Search<input name="q" defaultValue={sp.q} placeholder="Room, zone, fixture…" className={cn(select, "w-44")} /></label>
        <label>Deck<select name="deck" defaultValue={sp.deck ?? ""} className={select}><option value="">All</option>{decks.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Panel<select name="panel" defaultValue={sp.panel ?? ""} className={select}><option value="">All</option>{panels.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Load type<select name="type" defaultValue={sp.type ?? ""} className={select}><option value="">All</option>{types.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={sp.status ?? ""} className={select}><option value="">Any</option>{Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <button type="submit" className={buttonClass("secondary", "sm")}>Show</button>
      </form>
      {rows.length ? (
        <ActionForm action={setLoadsStatus} className="space-y-4">
          {canLog ? (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel p-2 text-sm shadow-sm">
              <span>Set ticked loads to</span>
              <select name="status" defaultValue="installed" className="h-9 rounded-md border border-line bg-panel px-2">{Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <SubmitButton pendingLabel="Saving…">Update</SubmitButton>
            </div>
          ) : null}
          {[...byArea.entries()].map(([area, list]) => (
            <Panel key={area} className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
                <h2 className="font-medium">{area}</h2>
                <p className="text-xs text-ink-muted">{list.length} loads · {list.filter((l) => ["commissioned", "tested"].includes(l.status as string)).length} done</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr className="border-b border-line text-left text-ink-muted">
                    {canLog ? <th className="w-8 px-3 py-1.5"><span className="sr-only">Select</span></th> : null}
                    {["Zone", "Load", "Fixture", "Type", "Panel / module / loop", "W", "Zone ID", "DALI addr.", "Status"].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {list.map((l) => (
                      <tr key={l.id} className="border-b border-line align-top last:border-0 hover:bg-panel-sunk">
                        {canLog ? <td className="px-3 py-1.5"><input type="checkbox" name="ids" value={l.id as string} aria-label={`Select load ${l.load_number}`} className="size-4" /></td> : null}
                        <td className="px-3 py-1.5"><Link href={`${base}/site/lighting/${l.id}`} className="font-medium hover:underline">{l.zone_number}. {l.zone_name}</Link></td>
                        <td className="tabular px-3 py-1.5">{l.load_number ?? "—"}</td>
                        <td className="px-3 py-1.5">{l.fixture}{l.quantity && l.quantity > 1 ? ` ×${l.quantity}` : ""}</td>
                        <td className="px-3 py-1.5">{l.load_type}</td>
                        <td className="px-3 py-1.5 text-xs">{[l.panel?.split("\\").at(-1), l.module, l.output].filter(Boolean).join(" · ")}</td>
                        <td className="tabular px-3 py-1.5">{l.wattage !== null ? Number(l.wattage) : "—"}</td>
                        <td className="tabular px-3 py-1.5 text-xs">{l.zone_href ?? "—"}</td>
                        <td className="tabular px-3 py-1.5">{l.dali_address ?? "—"}</td>
                        <td className="px-3 py-1.5"><Badge tone={ITEM_STATUS[l.status as string].tone}>{ITEM_STATUS[l.status as string].label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
          <Panel><Pager page={page} total={count ?? 0} size={SIZE} params={params2} /></Panel>
        </ActionForm>
      ) : <Panel><EmptyState title="No loads">Nothing matches, or no Lutron load schedule has been imported yet (Site → Import).</EmptyState></Panel>}
    </div>
  );
}
