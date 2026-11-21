import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject, namesOf } from "@/server/services/site";
import { DrawingUpload } from "@/components/site/site-upload";
import { DISCIPLINES } from "@/lib/site-constants";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Drawings" };

export default async function DrawingsPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ old?: string }> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  const { ctx, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  let q = supabase.from("project_drawings").select("id, discipline, number, title, revision, deck, file_name, size_bytes, uploaded_by, created_at, superseded_at").eq("project_id", id).is("archived_at", null);
  if (!sp.old) q = q.is("superseded_at", null);
  const { data } = await q.order("discipline").order("title").order("created_at", { ascending: false });
  const rows = data ?? [];
  const names = await namesOf(rows.map((r) => r.uploaded_by as string));
  const label = new Map(DISCIPLINES);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.discipline as string, [...(groups.get(r.discipline as string) ?? []), r]);
  const current = rows.filter((r) => !r.superseded_at).map((r) => ({ id: r.id as string, label: `${r.title}${r.revision ? ` rev ${r.revision}` : ""}` }));

  return (
    <div className="space-y-4">
      <PageHeader title="Drawings" description="General arrangements and discipline drawings (lighting, keypads, AV, Wi-Fi, data…). Uploading a new revision keeps the old one in the history." actions={<Link href={sp.old ? "?" : "?old=1"} className="text-sm underline">{sp.old ? "Current revisions only" : "Show old revisions"}</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {rows.length ? [...groups.entries()].map(([d, list]) => (
            <Panel key={d}>
              <PanelHeader title={label.get(d) ?? d} />
              <ul className="divide-y divide-line">
                {list.map((r) => (
                  <li key={r.id}><Link href={`${base}/drawings/${r.id}`} className="block px-4 py-3 hover:bg-panel-sunk sm:px-5">
                    <p className="font-medium">{r.number ? <span className="mr-1.5 text-ink-muted">{r.number}</span> : null}{r.title}{r.revision ? <span className="ml-1.5 text-sm text-ink-muted">rev {r.revision}</span> : null}{r.superseded_at ? <span className="ml-1.5 text-xs text-ink-muted">(superseded)</span> : null}</p>
                    <p className="text-xs text-ink-muted">{[r.deck, `${(Number(r.size_bytes) / 1048576).toFixed(1)} MB`, `${names.get(r.uploaded_by as string) ?? "—"}, ${formatDateTime(r.created_at as string, ctx.profile.timezone)}`].filter(Boolean).join(" · ")}</p>
                  </Link></li>
                ))}
              </ul>
            </Panel>
          )) : <Panel><EmptyState title="No drawings yet">Upload the GA and discipline drawings here.</EmptyState></Panel>}
        </div>
        {canLog ? (
          <Panel className="h-fit">
            <PanelHeader title="Upload a drawing" description="PDF, PNG or JPEG up to 50 MB. Images become a one-page PDF so you can add layers and download them marked up. Large A0/A1 sheets are fine." />
            <div className="p-4 sm:p-5"><DrawingUpload projectId={id} current={current} /></div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
