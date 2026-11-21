import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject } from "@/server/services/site";
import { EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lutron integration" };

const VIEWS = [["keypads", "Keypads"], ["zone", "Zones"], ["area", "Areas"], ["scene", "Area scenes"], ["shade_group", "Shade groups"], ["hvac_zone", "HVAC zones"]] as const;
type Item = { id: string; kind: string; path: string; href: string; integration_id: number; model: string | null; component: string | null; component_name: string | null; device_href: string | null; engraving: string | null };

export default async function LutronPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ view?: string; q?: string; deck?: string }> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { canEdit, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "keypads";
  const all: Item[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    let q = supabase.from("lutron_items").select("id, kind, path, href, integration_id, model, component, component_name, device_href, engraving").eq("project_id", id).is("archived_at", null);
    q = view === "keypads" ? q.in("kind", ["device", "button", "led"]) : q.eq("kind", view);
    if (sp.deck) q = q.like("path", `${sp.deck.replace(/[%_\\]/g, "")}%`);
    const { data } = await q.order("path").order("integration_id").range(from, from + 999);
    all.push(...((data ?? []) as Item[]));
    if (!data || data.length < 1000) break;
  }
  const text = (sp.q ?? "").trim().toLowerCase();
  const devices = all.filter((i) => i.kind === "device");
  const parts = new Map<string, Item[]>();
  for (const i of all) if (i.device_href) parts.set(i.device_href, [...(parts.get(i.device_href) ?? []), i]);
  const num = (s: string | null) => Number.parseInt((s ?? "").replace(/\D/g, ""), 10) || 0;
  const shownDevices = devices.filter((d) => !text || d.path.toLowerCase().includes(text) || String(d.integration_id).includes(text) || (d.model ?? "").toLowerCase().includes(text));
  const flat = all.filter((i) => !text || i.path.toLowerCase().includes(text) || String(i.integration_id).includes(text));
  const decks = ["TANK DECK", "LOWER DECK", "MAIN DECK", "OWNERS DECK", "BRIDGE DECK", "SUN DECK"];

  return (
    <div className="space-y-4">
      <PageHeader title="Lutron integration" description="Integration addresses for the programmer: every keypad with its buttons and LEDs, and every zone, area and scene, from the Lutron Designer integration report." actions={canEdit ? <a href={`${base}/site/export?kind=integration`} className={buttonClass("secondary", "sm")}>Integration schedule (Excel)</a> : undefined} />
      <nav aria-label="Integration views" className="flex flex-wrap gap-1 text-sm">
        {VIEWS.map(([k, label]) => <Link key={k} href={`?view=${k}${sp.deck ? `&deck=${encodeURIComponent(sp.deck)}` : ""}`} className={cn("rounded-md border px-3 py-1.5", view === k ? "border-brass bg-brass-soft/40 font-semibold" : "border-line")}>{label}</Link>)}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="view" value={view} />
        <label>Search<input name="q" defaultValue={sp.q} placeholder="Room, name or ID" className="mt-1 block h-9 w-52 rounded-md border border-line bg-panel px-2" /></label>
        <label>Deck<select name="deck" defaultValue={sp.deck ?? ""} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2"><option value="">All</option>{decks.map((d) => <option key={d}>{d}</option>)}</select></label>
        <button type="submit" className={buttonClass("secondary", "sm")}>Show</button>
      </form>
      {view === "keypads" ? (
        shownDevices.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {shownDevices.map((d) => {
              const list = (parts.get(d.href) ?? []).sort((a, b) => (a.kind === b.kind ? num(a.component) - num(b.component) || a.integration_id - b.integration_id : a.kind === "button" ? -1 : 1));
              return (
                <Panel key={d.id} className="overflow-hidden">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
                    <h2 className="min-w-0 break-words text-sm font-medium">{d.path}</h2>
                    <p className="tabular text-xs text-ink-muted">{d.model} · <span className="font-semibold text-ink">ID {d.integration_id}</span></p>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {list.map((c) => (
                        <tr key={c.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-1">{c.component}</td>
                          <td className="tabular px-2 py-1 font-medium">{c.integration_id}</td>
                          <td className="px-2 py-1 text-ink-muted">{c.engraving ?? c.component_name ?? ""}</td>
                          <td className="px-4 py-1 text-right">{c.kind === "button" ? <Link href={`${base}/site/lutron/${c.id}`} className="text-xs underline">Engraving</Link> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              );
            })}
          </div>
        ) : <Panel><EmptyState title="No keypads">Nothing matches, or no integration report has been imported yet (Site → Import).</EmptyState></Panel>
      ) : flat.length ? (
        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-ink-muted"><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Integration ID</th><th className="px-4 py-2 font-medium">Address</th></tr></thead>
            <tbody>{flat.map((i) => <tr key={i.id} className="border-b border-line last:border-0"><td className="px-4 py-1.5">{i.path}</td><td className="tabular px-4 py-1.5 font-medium">{i.integration_id}</td><td className="tabular px-4 py-1.5 text-xs text-ink-muted">{i.href}</td></tr>)}</tbody>
          </table>
        </Panel>
      ) : <Panel><EmptyState title="Nothing here">Nothing matches, or this report has no such items.</EmptyState></Panel>}
    </div>
  );
}
