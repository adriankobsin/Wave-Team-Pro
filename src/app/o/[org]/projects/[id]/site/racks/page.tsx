import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject } from "@/server/services/site";
import { addRack } from "@/server/actions/racks";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Racks" };

const MINI: Record<string, string> = {
  equipment: "bg-brass/70", switch: "bg-sky-500", patch_panel: "bg-ink-muted/40", brush: "bg-zinc-500", ups: "bg-ok", pdu: "bg-ok/70",
  shelf: "bg-ink-muted/20", blank: "bg-ink-muted/10", fan: "bg-ink-muted/30", other: "bg-ink-muted/30",
};

export default async function RacksPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const { base, canLog } = await getSiteProject(org, id);
  const supabase = await createClient();
  const [{ data: racks }, { data: items }] = await Promise.all([
    supabase.from("site_racks").select("id, name, units, location").eq("project_id", id).is("archived_at", null).order("name"),
    supabase.from("site_rack_items").select("rack_id, u_bottom, u_size, kind, label").eq("project_id", id).limit(5000),
  ]);
  const byRack = new Map<string, NonNullable<typeof items>>();
  for (const i of items ?? []) byRack.set(i.rack_id as string, [...(byRack.get(i.rack_id as string) ?? []), i]);

  return (
    <div className="space-y-4">
      <PageHeader title="Racks" description="Open a rack to move equipment between U positions, change heights, or drop in devices, shelves, blanks and patch panels." actions={<Link href={`${base}/labels?pick=racks`} className="text-sm underline">QR stickers for racks</Link>} />
      {canLog ? (
        <details className="rounded-lg border border-line bg-panel">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">+ Add a rack</summary>
          <ActionForm action={addRack} resetOnSuccess className="grid gap-3 border-t border-line p-4 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
            <input type="hidden" name="projectId" value={id} />
            <TextField label="Name" name="name" required maxLength={80} placeholder="552-R6 - AV RACK" />
            <TextField label="Height (U)" name="units" type="number" min={1} max={60} defaultValue="42" required />
            <TextField label="Location" name="location" optional maxLength={120} placeholder="Tank deck AV room" />
            <SubmitButton pendingLabel="Adding…">Add rack</SubmitButton>
          </ActionForm>
        </details>
      ) : null}
      {racks?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {racks.map((r) => {
            const list = byRack.get(r.id as string) ?? [];
            const units = r.units as number;
            const used = list.reduce((n, i) => n + (i.u_size as number), 0);
            return (
              <Link key={r.id} href={`${base}/site/racks/${r.id}`} className="group block rounded-lg border border-line bg-panel p-3 hover:border-brass">
                <p className="truncate text-sm font-semibold group-hover:underline">{r.name}</p>
                <p className="mb-2 text-xs text-ink-muted">{units}U · {used}U used{r.location ? ` · ${r.location}` : ""}</p>
                <div className="relative mx-auto w-full max-w-28 rounded border-2 border-ink/60 bg-panel-sunk" style={{ height: Math.max(units * 4, 48) }}>
                  {list.map((i, n) => (
                    <div key={n} className={cn("absolute inset-x-0.5 rounded-[1px]", MINI[i.kind as string] ?? MINI.other)}
                      style={{ top: `${((units - ((i.u_bottom as number) + (i.u_size as number) - 1)) / units) * 100}%`, height: `calc(${((i.u_size as number) / units) * 100}% - 1px)` }} title={i.label as string} />
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      ) : <Panel><EmptyState title="No racks yet">Import the network spreadsheet on the Site page, or add a rack above.</EmptyState></Panel>}
    </div>
  );
}
