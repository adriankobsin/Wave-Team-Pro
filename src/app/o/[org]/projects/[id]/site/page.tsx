import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject, namesOf, siteCounts } from "@/server/services/site";
import { SiteImport } from "@/components/site/site-upload";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Site" };

function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-line bg-panel p-4 hover:border-brass/60">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="display tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-ink-muted">{sub}</p> : null}
    </Link>
  );
}

export default async function SitePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const { ctx, canEdit, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const [c, { data: imports }] = await Promise.all([
    siteCounts(id),
    supabase.from("site_imports").select("id, kind, file_name, counts, imported_by, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  const names = await namesOf((imports ?? []).map((i) => i.imported_by as string));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const KIND: Record<string, string> = { network: "Network spreadsheet / cable schedule", lutron_integration: "Lutron integration report", lutron_loads: "Lutron load schedule" };

  return (
    <div className="space-y-6">
      <PageHeader title="Site" description="Network, cables, devices, Lutron lighting and drawings for this project. Everyone on the project team can record tests and statuses; every change is kept with who and when." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cables tested" value={`${c.passed} / ${c.cablesInUse}`} sub={`${pct(c.passed, c.cablesInUse)} passed · ${c.failed} failed · ${c.review} to review`} href={`${base}/site/cables`} />
        <Stat label="Devices" value={String(c.devices)} sub="Network, AV, phones, cameras…" href={`${base}/site/devices`} />
        <Stat label="Lighting loads done" value={`${c.loadsDone} / ${c.loads}`} sub="Commissioned or tested" href={`${base}/site/lighting`} />
        <Stat label="Lutron integration" value={`${c.lutron} keypads`} sub={`${c.zones} zones with integration addresses`} href={`${base}/site/lutron`} />
        <Stat label="Switch ports" value={String(c.ports)} sub="Switches, router, firewall, PBX" href={`${base}/site/switches`} />
        <Stat label="VLANs" value={String(c.vlans)} sub="With IP addresses in use" href={`${base}/site/ip`} />
        <Stat label="Patch panel ports" value={String(c.cables)} sub={`${c.cablesInUse} with a cable`} href={`${base}/site/cables?all=1`} />
        <Stat label="Drawings" value={String(c.drawings)} sub="GA and discipline drawings" href={`${base}/drawings`} />
      </div>

      {canEdit ? <div className="flex flex-wrap gap-2">
        <a href={`${base}/site/export?kind=cables`} className={buttonClass("secondary", "sm")}>Cable schedule (Excel)</a>
        <a href={`${base}/site/export?kind=devices`} className={buttonClass("secondary", "sm")}>Device list (Excel)</a>
        <a href={`${base}/site/export?kind=ports`} className={buttonClass("secondary", "sm")}>Switch ports (Excel)</a>
        <a href={`${base}/site/export?kind=integration`} className={buttonClass("secondary", "sm")}>Lutron integration schedule (Excel)</a>
        <a href={`${base}/site/export?kind=loads`} className={buttonClass("secondary", "sm")}>Lighting load schedule (Excel)</a>
        <a href={`${base}/export#handover`} className={buttonClass("secondary", "sm")}>Client handover document (PDF)</a>
      </div> : null}

      {canEdit ? (
        <Panel>
          <PanelHeader title="Import" description="Load or refresh this project's schedules. Re-importing updates descriptions but never overwrites test results, statuses or notes recorded here. Usernames and passwords in spreadsheets are never imported." />
          <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-3">
            <SiteImport projectId={id} kind="network" label="Network spreadsheet or cable schedule (.xlsx)" accept=".xlsx" hint="Device list, patch panel schedule, switch / router sheets, WLAN, CCTV, IP scheme and racks — or a cable schedule (From / To). Import the network spreadsheet first, then the cable schedule. Usernames and passwords are never read." />
            <SiteImport projectId={id} kind="lutron_integration" label="Lutron Integration Report (PDF)" accept=".pdf,application/pdf" hint="From Lutron Designer: keypads, buttons, LEDs, zones, areas and scenes with integration addresses. Import this before the load schedule." />
            <SiteImport projectId={id} kind="lutron_loads" label="Lutron Load Schedule (PDF)" accept=".pdf,application/pdf" hint="From Lutron Designer: every load by area and zone with panel, module and loop." />
          </div>
        </Panel>
      ) : null}

      {imports?.length ? (
        <Panel>
          <PanelHeader title="Import history" />
          <ul className="divide-y divide-line text-sm">
            {imports.map((i) => (
              <li key={i.id} className="px-4 py-2.5 sm:px-5">
                <span className="font-medium">{KIND[i.kind as string] ?? i.kind}</span> · {i.file_name}
                <span className="block text-xs text-ink-muted">{formatDateTime(i.created_at as string, ctx.profile.timezone)} · {names.get(i.imported_by as string) ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
