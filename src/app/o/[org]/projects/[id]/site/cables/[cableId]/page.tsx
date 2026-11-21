import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DECKS, TEST_RESULT, changesOf, getSiteProject, namesOf, projectTeam } from "@/server/services/site";
import { saveCable } from "@/server/actions/site";
import { ChangeHistory } from "@/components/site/change-history";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";

export const metadata: Metadata = { title: "Cable" };

export default async function CablePage({ params }: { params: Promise<{ org: string; id: string; cableId: string }> }) {
  const { org, id, cableId } = await params;
  if (!z.uuid().safeParse(cableId).success) notFound();
  const { ctx, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const { data: c } = await supabase.from("site_cables").select("*").eq("id", cableId).eq("project_id", id).maybeSingle();
  if (!c) notFound();
  const [changes, people, device] = await Promise.all([
    changesOf(cableId), projectTeam(id),
    c.device_id ? supabase.from("site_devices").select("id, name, ip, type").eq("id", c.device_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const testerIds = ((c.tested_by_ids as string[] | null) ?? []).length ? (c.tested_by_ids as string[]) : c.tested_by ? [c.tested_by as string] : [];
  const inHistory = changes.flatMap((x) => [x.changes.tested_by, x.changes.tested_by_ids].flatMap((pair) => (pair ?? []).flat())).filter((u): u is string => typeof u === "string");
  const names = await namesOf([...testerIds, ...inHistory, ...changes.map((x) => x.changed_by)]);
  const team = [...people, ...testerIds.filter((u) => !people.some((p) => p.id === u)).map((u) => ({ id: u, name: names.get(u) ?? "Someone", job: "no longer on the team" }))];
  const testerNames = testerIds.map((u) => names.get(u) ?? "someone").join(", ");
  const result = TEST_RESULT[c.test_result as string];

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href={`${base}/site/cables`} className="underline">← All cables</Link></p>
      <PageHeader title={c.label ?? `Spare port ${c.port}`} description={`${c.patch_panel} port ${c.port}${c.rack ? ` · rack ${c.rack}` : ""}`} actions={<Badge tone={result.tone}>{result.label}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Test and details" description={c.tested_on ? `Last test ${c.tested_on}${testerIds.length ? ` by ${testerNames}` : c.tested_by_name ? ` (${c.tested_by_name})` : ""}` : "Not tested yet."} />
          {canLog ? (
            <ActionForm action={saveCable} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <input type="hidden" name="id" value={c.id} />
              <SelectField label="Test result" name="test_result" defaultValue={c.test_result as string}>
                {Object.entries(TEST_RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </SelectField>
              <TextField label="Length (m)" name="length_m" type="number" step="0.1" min={0} optional defaultValue={c.length_m ?? ""} />
              <TextField label="Tested on" name="tested_on" type="date" optional defaultValue={c.tested_on ?? ""} hint="Today if left empty" />
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Tested by <span className="font-normal text-ink-muted">(tick everyone who tested it; you, if nobody is ticked)</span></legend>
                {team.length ? (
                  <div className="mt-1 grid max-h-48 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                    {team.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="tested_by" value={p.id} defaultChecked={testerIds.includes(p.id)} className="size-4" />
                        {p.name}{p.job ? <span className="text-xs text-ink-muted">{p.job}</span> : null}
                      </label>
                    ))}
                  </div>
                ) : <p className="mt-1 text-sm text-ink-muted">Nobody is on this project&apos;s team yet. Add people on the project Overview.</p>}
              </fieldset>
              <div className="sm:col-span-2"><TextAreaField label="Notes" name="notes" optional rows={2} maxLength={4000} defaultValue={c.notes ?? ""} placeholder="e.g. NEXT margin low, re-terminated outlet end" /></div>
              <TextField label="Label (cable no.)" name="label" optional maxLength={120} defaultValue={c.label ?? ""} />
              <TextField label="Cable type" name="cable_type" optional maxLength={60} defaultValue={c.cable_type ?? ""} placeholder="CAT6A" />
              <TextField label="Room" name="room" optional maxLength={60} defaultValue={c.room ?? ""} />
              <TextField label="Location" name="location" optional maxLength={120} defaultValue={c.location ?? ""} />
              <TextField label="Device" name="device_name" optional maxLength={200} defaultValue={c.device_name ?? ""} />
              <TextField label="Switch port" name="switch_port" optional maxLength={80} defaultValue={c.switch_port ?? ""} />
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="installed" defaultChecked={Boolean(c.installed)} className="size-5" /> Installed</label>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
            </ActionForm>
          ) : (
            <dl className="grid gap-2 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-muted">Length</dt><dd>{c.length_m !== null ? `${Number(c.length_m)} m` : "—"}</dd></div>
              <div><dt className="text-ink-muted">Type</dt><dd>{c.cable_type ?? "—"}</dd></div>
            </dl>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Where it goes" />
            <dl className="grid gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-2 sm:p-5">
              <div><dt className="text-ink-muted">Deck</dt><dd>{c.deck ? DECKS[c.deck as string] ?? c.deck : "—"}</dd></div>
              <div><dt className="text-ink-muted">Room</dt><dd>{[c.room, c.location].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div><dt className="text-ink-muted">System</dt><dd>{c.system ?? "—"}</dd></div>
              <div><dt className="text-ink-muted">Switch port</dt><dd>{c.switch_port ?? "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink-muted">Device</dt><dd>{device ? <Link href={`${base}/site/devices/${device.id}`} className="underline">{device.name}</Link> : c.device_name ?? "—"}{device?.ip ? ` · ${device.ip}` : ""}</dd></div>
            </dl>
          </Panel>
          <ChangeHistory changes={changes} names={names} tz={ctx.profile.timezone} people={new Map(team.map((p) => [p.id, p.name]))} />
        </div>
      </div>
    </div>
  );
}
