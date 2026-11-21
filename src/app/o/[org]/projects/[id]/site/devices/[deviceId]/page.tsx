import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DECKS, ITEM_STATUS, changesOf, getSiteProject, namesOf, siteSuggestions } from "@/server/services/site";
import { saveDevice } from "@/server/actions/site";
import { Suggestions } from "@/components/site/edit-tables";
import { ChangeHistory } from "@/components/site/change-history";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Device" };

export default async function DevicePage({ params }: { params: Promise<{ org: string; id: string; deviceId: string }> }) {
  const { org, id, deviceId } = await params;
  if (!z.uuid().safeParse(deviceId).success) notFound();
  const { ctx, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const { data: d } = await supabase.from("site_devices").select("*").eq("id", deviceId).eq("project_id", id).maybeSingle();
  if (!d) notFound();
  const [changes, { data: cables }, { data: ports }] = await Promise.all([
    changesOf(deviceId),
    supabase.from("site_cables").select("id, label, patch_panel, port, test_result, length_m").eq("project_id", id).eq("device_id", deviceId),
    d.ip ? supabase.from("site_ports").select("equipment, port, vlan, poe_w").eq("project_id", id).eq("end_ip", d.ip).limit(5) : Promise.resolve({ data: [] }),
  ]);
  const names = await namesOf([d.status_by, ...changes.map((x) => x.changed_by)]);
  const st = ITEM_STATUS[d.status as string];
  const facts: [string, unknown][] = [
    ["Deck", d.deck ? DECKS[d.deck as string] ?? d.deck : null], ["Room", [d.room, d.location].filter(Boolean).join(" · ")], ["System", d.system], ["Type", d.type],
    ["Hostname", d.hostname], ["Port", d.port], ["PoE", d.poe_w ? `${Number(d.poe_w)} W` : null], ["Patch panel", d.patch_panel ? `${d.patch_panel} port ${d.patch_port}` : null],
    ["Switch port", d.switch_port ?? (ports ?? []).map((p) => `${p.equipment} ${p.port} (VLAN ${p.vlan ?? "—"})`).join(", ")], ["Cable", d.cable_label],
  ];
  return (
    <div className="space-y-4">
      <Suggestions lists={await siteSuggestions(id)} />
      <p className="text-sm"><Link href={`${base}/site/devices`} className="underline">← All devices</Link></p>
      <PageHeader title={d.name} description={[d.type, d.model, d.ip].filter(Boolean).join(" · ")} actions={<Badge tone={st.tone}>{st.label}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Status and details" description={d.status_at ? `${st.label} ${formatDateTime(d.status_at as string, ctx.profile.timezone)}${d.status_by ? ` by ${names.get(d.status_by as string)}` : ""}` : undefined} />
          {canLog ? (
            <ActionForm action={saveDevice} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <input type="hidden" name="id" value={d.id} />
              <SelectField label="Status" name="status" defaultValue={d.status as string}>{Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</SelectField>
              <TextField label="Name" name="name" required maxLength={200} defaultValue={d.name} />
              <TextField label="Manufacturer" name="manufacturer" optional maxLength={80} list="dl-manufacturers" defaultValue={d.manufacturer ?? ""} />
              <TextField label="Model" name="model" optional maxLength={120} defaultValue={d.model ?? ""} />
              <TextField label="Type" name="type" optional maxLength={80} list="dl-types" defaultValue={d.type ?? ""} />
              <TextField label="System" name="system" optional maxLength={80} list="dl-systems" defaultValue={d.system ?? ""} />
              <TextField label="Deck" name="deck" optional maxLength={80} list="dl-decks" defaultValue={d.deck ?? ""} />
              <TextField label="IP address" name="ip" optional maxLength={60} defaultValue={d.ip ?? ""} />
              <TextField label="MAC" name="mac" optional maxLength={40} defaultValue={d.mac ?? ""} />
              <TextField label="Serial" name="serial" optional maxLength={80} defaultValue={d.serial ?? ""} />
              <TextField label="Firmware" name="firmware" optional maxLength={60} defaultValue={d.firmware ?? ""} />
              <TextField label="Room" name="room" optional maxLength={80} list="dl-rooms" defaultValue={d.room ?? ""} />
              <TextField label="Location" name="location" optional maxLength={120} defaultValue={d.location ?? ""} />
              <div className="sm:col-span-2"><TextAreaField label="Notes" name="notes" optional rows={2} maxLength={4000} defaultValue={d.notes ?? ""} /></div>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
            </ActionForm>
          ) : null}
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Connection" />
            <dl className="grid gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-2 sm:p-5">
              {facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd className="break-all">{String(v)}</dd></div>)}
            </dl>
            {cables?.length ? (
              <ul className="border-t border-line px-4 py-3 text-sm sm:px-5">
                {cables.map((c) => <li key={c.id}><Link href={`${base}/site/cables/${c.id}`} className="underline">{c.label ?? `${c.patch_panel} ${c.port}`}</Link> · {c.test_result === "passed" ? "passed" : c.test_result.replace("_", " ")}{c.length_m !== null ? ` · ${Number(c.length_m)} m` : ""}</li>)}
              </ul>
            ) : null}
          </Panel>
          <ChangeHistory changes={changes} names={names} tz={ctx.profile.timezone} />
        </div>
      </div>
    </div>
  );
}
