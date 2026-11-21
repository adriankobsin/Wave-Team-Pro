import type { Metadata } from "next";
import { getSiteProject } from "@/server/services/site";
import { labelTargets } from "@/server/services/labels";
import { LABEL_SHEETS } from "@/lib/export/labels";
import { LabelPicker } from "@/components/site/label-picker";
import { PageHeader, Panel } from "@/components/ui/misc";

export const metadata: Metadata = { title: "QR labels" };

export default async function LabelsPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ pick?: string }> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { project, base } = await getSiteProject(org, id);
  const groups = await labelTargets(id, project.name);
  return (
    <div className="space-y-4">
      <PageHeader title="QR labels" description="Stickers for racks, patch panels, switches, lighting panels and drawings. An engineer scans one with their phone and gets a PDF of that exact item, made from the live schedule at that moment, to read or save on the phone. Stickers already printed keep working. Codes only open for people signed in with access to this project." />
      <Panel className="p-4 sm:p-5">
        <LabelPicker action={`${base}/labels/pdf`} groups={groups} preselect={sp.pick ?? ""} sheets={Object.entries(LABEL_SHEETS).map(([k, v]) => ({ key: k, name: v.name }))} />
      </Panel>
    </div>
  );
}
