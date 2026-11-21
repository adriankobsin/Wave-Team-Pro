import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ITEM_STATUS, changesOf, getSiteProject, namesOf } from "@/server/services/site";
import { saveLoad } from "@/server/actions/site";
import { ChangeHistory } from "@/components/site/change-history";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Lighting load" };

export default async function LoadPage({ params }: { params: Promise<{ org: string; id: string; loadId: string }> }) {
  const { org, id, loadId } = await params;
  if (!z.uuid().safeParse(loadId).success) notFound();
  const { ctx, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const { data: l } = await supabase.from("lighting_loads").select("*").eq("id", loadId).eq("project_id", id).maybeSingle();
  if (!l) notFound();
  const changes = await changesOf(loadId);
  const names = await namesOf([l.status_by, ...changes.map((x) => x.changed_by)]);
  const st = ITEM_STATUS[l.status as string];
  const facts: [string, unknown][] = [
    ["Area", l.area], ["Zone", `${l.zone_number}. ${l.zone_name}`], ["Zone integration address", l.zone_href], ["Load number", l.load_number], ["Fixture", `${l.fixture}${l.quantity ? ` (${l.quantity})` : ""}`],
    ["Load type", l.load_type], ["Panel", l.panel], ["Module", l.module], ["Loop / output", l.output], ["Wattage", l.wattage !== null ? `${Number(l.wattage)} W` : "Unspecified"], ["Feed", l.feed],
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href={`${base}/site/lighting`} className="underline">← All lighting loads</Link></p>
      <PageHeader title={`${l.zone_name} · load ${l.load_number ?? ""}`} description={l.area as string} actions={<Badge tone={st.tone}>{st.label}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Install and commissioning" description={l.status_at ? `${st.label} ${formatDateTime(l.status_at as string, ctx.profile.timezone)}${l.status_by ? ` by ${names.get(l.status_by as string)}` : ""}` : undefined} />
          {canLog ? (
            <ActionForm action={saveLoad} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <input type="hidden" name="id" value={l.id} />
              <SelectField label="Status" name="status" defaultValue={l.status as string}>{Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</SelectField>
              <TextField label="DALI short address" name="dali_address" optional maxLength={20} defaultValue={l.dali_address ?? ""} placeholder="0–63" />
              <div className="sm:col-span-2"><TextField label="Driver (make / model)" name="driver" optional maxLength={120} defaultValue={l.driver ?? ""} /></div>
              <div className="sm:col-span-2"><TextAreaField label="Notes" name="notes" optional rows={2} maxLength={4000} defaultValue={l.notes ?? ""} placeholder="e.g. driver in ceiling above wardrobe, access panel B" /></div>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
            </ActionForm>
          ) : null}
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="From the load schedule" />
            <dl className="grid gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-2 sm:p-5">
              {facts.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd className="break-words">{String(v)}</dd></div>)}
            </dl>
          </Panel>
          <ChangeHistory changes={changes} names={names} tz={ctx.profile.timezone} />
        </div>
      </div>
    </div>
  );
}
