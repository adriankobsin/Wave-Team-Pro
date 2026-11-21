import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject } from "@/server/services/site";
import { getLogo } from "@/server/services/branding";
import { PACK_SECTIONS } from "@/server/services/project-pack";
import { ExportForm } from "@/components/site/export-form";
import { functionFor } from "@/lib/handover/build";
import { HandoverForm } from "@/components/site/handover-form";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Export" };

export default async function ExportPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const { ctx, canEdit, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const count = async (table: string, extra?: (q: ReturnType<typeof base_>) => ReturnType<typeof base_>) => {
    let q = base_(table);
    if (extra) q = extra(q);
    return (await q).count ?? 0;
  };
  function base_(table: string) { return supabase.from(table).select("id", { count: "exact", head: true }).eq("project_id", id); }
  const [tasks, notes, cables, devices, ports, vlans, ips, racks, loads, lutron, drawings, logo] = await Promise.all([
    count("tasks", (q) => q.is("archived_at", null)), count("project_notes", (q) => q.is("archived_at", null)),
    count("site_cables", (q) => q.is("archived_at", null).not("label", "is", null)), count("site_devices", (q) => q.is("archived_at", null)),
    count("site_ports", (q) => q.is("archived_at", null)), count("site_vlans", (q) => q.is("archived_at", null)), count("site_ips", (q) => q.is("archived_at", null)),
    count("site_racks", (q) => q.is("archived_at", null)), count("lighting_loads", (q) => q.is("archived_at", null)), count("lutron_items"),
    count("project_drawings", (q) => q.is("archived_at", null).is("superseded_at", null)), getLogo(ctx.org.id),
  ]);
  const { data: sysRows } = await supabase.from("site_devices").select("system").eq("project_id", id).is("archived_at", null).limit(5000);
  const sysCount = new Map<string, number>();
  for (const r of sysRows ?? []) { const k = (r.system as string | null) || "Other equipment"; sysCount.set(k, (sysCount.get(k) ?? 0) + 1); }
  const handoverSystems = [...sysCount.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, n]) => ({ code, name: functionFor(code).name, count: n }));
  const info: Record<string, string> = {
    summary: `${tasks} tasks · ${notes} log entries`, money: "Hours by person and expense claims — leave this off for packs going to clients",
    cables: `${cables} cables`, devices: `${devices} devices`, switches: `${ports} switch ports`, network: `${vlans} VLANs · ${ips} IP addresses`,
    racks: `${racks} racks, drawn to scale`, lighting: `${loads} loads`, lutron: `${lutron} integration IDs`, drawings: `${drawings} current drawings, each with its layers marked and a legend`,
  };
  const empty: Record<string, boolean> = { cables: !cables, devices: !devices, switches: !ports, network: !vlans && !ips, racks: !racks, lighting: !loads, lutron: !lutron, drawings: !drawings };

  return (
    <div className="space-y-4">
      <PageHeader title="Export" description="One PDF with everything about this project, branded with the company logo: a cover page, contents, and each section you tick below." />
      {!logo ? <Notice tone="warn" title="No company logo yet">The pack will show the company name instead. A super admin can upload it under Admin → Settings → Company logo.</Notice> : null}
      {canEdit ? (
        <Panel className="p-4 sm:p-5">
          <ExportForm action={`${base}/export/pack`} sections={PACK_SECTIONS.map(([k, label]) => ({ key: k, label, info: info[k], empty: Boolean(empty[k]), defaultOn: k !== "money" && !empty[k] }))} />
        </Panel>
      ) : (
        <Notice tone="neutral" title="Project managers export">Only the project manager and super admins can download the project pack.</Notice>
      )}
      {canEdit ? (
        <Panel id="handover">
          <PanelHeader title="Client handover document" description="For the client to sign: the complete equipment list, what each system does, tick boxes proving every item is installed and working, and signature and date blocks for acceptance." />
          <div className="p-4 sm:p-5"><HandoverForm action={`${base}/export/handover`} count={devices} systems={handoverSystems} defaultClient="" /></div>
        </Panel>
      ) : null}
      {canEdit ? (
        <p className="text-sm text-ink-muted">Need a spreadsheet instead? The Excel files are on each schedule page, and the project report is on the <a href={base} className="underline">Overview</a>. <a href={`${base}/report?format=pdf`} className={buttonClass("secondary", "sm")}>Project report only (PDF)</a></p>
      ) : null}
    </div>
  );
}
