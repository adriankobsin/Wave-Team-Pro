import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { changesOf, getSiteProject, namesOf } from "@/server/services/site";
import { saveLutronItem } from "@/server/actions/site";
import { ChangeHistory } from "@/components/site/change-history";
import { ActionForm } from "@/components/ui/action-form";
import { TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";

export const metadata: Metadata = { title: "Keypad button" };

export default async function LutronItemPage({ params }: { params: Promise<{ org: string; id: string; itemId: string }> }) {
  const { org, id, itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const { ctx, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  const { data: i } = await supabase.from("lutron_items").select("*").eq("id", itemId).eq("project_id", id).maybeSingle();
  if (!i) notFound();
  const changes = await changesOf(itemId);
  const names = await namesOf(changes.map((x) => x.changed_by));
  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href={`${base}/site/lutron`} className="underline">← Lutron integration</Link></p>
      <PageHeader title={`${i.component ?? i.kind} · ID ${i.integration_id}`} description={i.path as string} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Engraving and notes" description="The engraving shows in the integration schedule for the programmer and for ordering keypads." />
          {canLog ? (
            <ActionForm action={saveLutronItem} className="space-y-3 p-4 sm:p-5">
              <input type="hidden" name="id" value={i.id} />
              <TextField label="Engraving" name="engraving" optional maxLength={200} defaultValue={i.engraving ?? ""} placeholder="e.g. RELAX" />
              <TextField label="Name" name="component_name" optional maxLength={200} defaultValue={i.component_name ?? ""} />
              <TextAreaField label="Notes" name="notes" optional rows={2} maxLength={2000} defaultValue={i.notes ?? ""} />
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </ActionForm>
          ) : null}
        </Panel>
        <ChangeHistory changes={changes} names={names} tz={ctx.profile.timezone} />
      </div>
    </div>
  );
}
