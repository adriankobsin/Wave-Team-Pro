import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DECKS, PAGE_SIZE, TEST_RESULT, getSiteProject, namesOf, projectTeam, siteSuggestions } from "@/server/services/site";
import { Pager } from "@/components/site/site-nav";
import { CableTable, Suggestions, type CableRow } from "@/components/site/edit-tables";
import { EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cables & patch panels" };

type Sp = { sort?: string; q?: string; panel?: string; deck?: string; system?: string; result?: string; all?: string; page?: string };

export default async function CablesPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<Sp> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { canEdit, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  let q = supabase.from("site_cables")
    .select("id, label, rack, patch_panel, port, cable_type, system, deck, room, location, device_name, switch_port, installed, test_result, length_m, tested_on, tested_by, tested_by_ids, tested_by_name", { count: "exact" })
    .eq("project_id", id).is("archived_at", null);
  if (!sp.all) q = q.not("label", "is", null);
  if (sp.panel) q = q.eq("patch_panel", sp.panel);
  if (sp.deck) q = q.eq("deck", sp.deck);
  if (sp.system) q = q.eq("system", sp.system);
  if (sp.result && sp.result in TEST_RESULT) q = q.eq("test_result", sp.result);
  const text = (sp.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (text) q = q.or(`label.ilike.%${text}%,device_name.ilike.%${text}%,room.ilike.%${text}%,location.ilike.%${text}%,switch_port.ilike.%${text}%`);
  const sort = sp.sort === "location" || sp.sort === "label" ? sp.sort : "panel";
  if (sort === "location") q = q.order("deck", { nullsFirst: false }).order("room", { nullsFirst: false }).order("location", { nullsFirst: false });
  else if (sort === "label") q = q.order("label", { nullsFirst: false });
  const [{ data, count }, { data: facets }, suggestions, team] = await Promise.all([
    q.order("patch_panel").order("port").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("site_cables").select("patch_panel, deck, system").eq("project_id", id).is("archived_at", null).limit(5000),
    siteSuggestions(id),
    projectTeam(id),
  ]);
  const rows = data ?? [];
  const names = await namesOf(rows.flatMap((r) => [r.tested_by as string, ...((r.tested_by_ids as string[] | null) ?? [])]));
  const uniq = (k: "patch_panel" | "deck" | "system") => [...new Set((facets ?? []).map((f) => f[k] as string | null).filter((x): x is string => Boolean(x)))].sort();
  const params2 = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && v)) as Record<string, string>;
  const select = "mt-1 block h-9 rounded-md border border-line bg-panel px-2";

  return (
    <div className="space-y-4">
      <PageHeader title="Cables & patch panels" description="Click any cell to type in it; it saves when you press Enter or click away. Pick a test result, and under Tested by tick everyone on the project team who tested it (you, if nobody is ticked). Tick rows or a whole patch panel to give them a common room, deck or result." actions={<div className="flex gap-2"><a href={`${base}/labels?pick=patch`} className={buttonClass("secondary", "sm")}>QR labels</a>{canEdit ? <a href={`${base}/site/export?kind=cables`} className={buttonClass("secondary", "sm")}>Excel</a> : null}</div>} />
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label>Search<input name="q" defaultValue={sp.q} placeholder="Label, room, device…" className={cn(select, "w-48")} /></label>
        <label>Patch panel<select name="panel" defaultValue={sp.panel ?? ""} className={select}><option value="">All</option>{uniq("patch_panel").map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Deck<select name="deck" defaultValue={sp.deck ?? ""} className={select}><option value="">All</option>{uniq("deck").map((x) => <option key={x} value={x}>{DECKS[x] ?? x}</option>)}</select></label>
        <label>System<select name="system" defaultValue={sp.system ?? ""} className={select}><option value="">All</option>{uniq("system").map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Test<select name="result" defaultValue={sp.result ?? ""} className={select}><option value="">Any</option>{Object.entries(TEST_RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Sort by<select name="sort" defaultValue={sort} className={select}><option value="panel">Patch panel</option><option value="location">Deck and room</option><option value="label">Cable no.</option></select></label>
        <label className="flex h-9 items-center gap-1.5 self-end"><input type="checkbox" name="all" value="1" defaultChecked={Boolean(sp.all)} /> Include spare ports</label>
        <button type="submit" className={buttonClass("secondary", "sm")}>Show</button>
      </form>
      <Panel className="overflow-hidden">
        {rows.length ? (
          <>
            <Suggestions lists={suggestions} />
            <CableTable rows={rows as CableRow[]} base={base} canLog={canLog} canEdit={canEdit} testers={Object.fromEntries(names)} team={team} groupByPanel={sort === "panel"} />
            <Pager page={page} total={count ?? 0} size={PAGE_SIZE} params={params2} />
          </>
        ) : <EmptyState title="No cables">Nothing matches, or no network spreadsheet has been imported yet (Site → Import).</EmptyState>}
      </Panel>
    </div>
  );
}
