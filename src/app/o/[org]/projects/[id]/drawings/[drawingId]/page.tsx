import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteProject, namesOf } from "@/server/services/site";
import { archiveDrawing } from "@/server/actions/site-import";
import { DrawingMarkup, type Cable, type Layer, type Marker, type MarkupDevice, type MarkupKeypad, type MarkupRack } from "@/components/drawings/drawing-markup";
import { DISCIPLINES } from "@/lib/site-constants";
import { InlineActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Drawing" };

export default async function DrawingPage({ params }: { params: Promise<{ org: string; id: string; drawingId: string }> }) {
  const { org, id, drawingId } = await params;
  if (!z.uuid().safeParse(drawingId).success) notFound();
  const { ctx, canEdit, canLog, base } = await getSiteProject(org, id);
  const supabase = await createClient();
  // Read through the viewer's own session first (RLS), then sign a short-lived link to the file.
  const { data: d } = await supabase.from("project_drawings").select("*").eq("id", drawingId).eq("project_id", id).is("archived_at", null).maybeSingle();
  if (!d) notFound();
  const [{ data: signed }, { data: history }, { data: markers }, { data: devices }, { data: keypads }, { data: layers }, { data: cables }, { data: racks }, { data: loadPanels }] = await Promise.all([
    createAdminClient().storage.from("files").createSignedUrl(d.storage_path as string, 3600),
    supabase.from("project_drawings").select("id, revision, created_at, superseded_at, supersedes").eq("project_id", id).is("archived_at", null).or(`id.eq.${d.supersedes ?? drawingId},supersedes.eq.${drawingId}`),
    supabase.from("drawing_markers").select("id, layer_id, page, x, y, kind, label, notes, device_id, lutron_item_id, rack_id").eq("drawing_id", drawingId).limit(5000),
    supabase.from("site_devices").select("id, name, type, room, deck").eq("project_id", id).is("archived_at", null).order("deck").order("room").order("name").limit(3000),
    supabase.from("lutron_items").select("id, path, model, integration_id").eq("project_id", id).eq("kind", "device").order("path").limit(2000),
    supabase.from("drawing_layers").select("id, name, kind, color, sort").eq("drawing_id", drawingId).order("sort").order("name"),
    supabase.from("drawing_cables").select("id, layer_id, page, points, label, cable_type, rack_id, notes").eq("drawing_id", drawingId).order("created_at").limit(5000),
    supabase.from("site_racks").select("id, name, location").eq("project_id", id).is("archived_at", null).order("name").limit(500),
    supabase.from("lighting_loads").select("panel").eq("project_id", id).is("archived_at", null).not("panel", "is", null).limit(20000),
  ]);
  if (!signed?.signedUrl) notFound();
  const names = await namesOf([d.uploaded_by as string]);
  const discipline = new Map(DISCIPLINES).get(d.discipline as string) ?? d.discipline;
  const others = (history ?? []).filter((h) => h.id !== d.id);

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href={`${base}/drawings`} className="underline">← All drawings</Link></p>
      <PageHeader
        title={`${d.number ? `${d.number} · ` : ""}${d.title}${d.revision ? ` rev ${d.revision}` : ""}`}
        description={[discipline, d.deck, `uploaded by ${names.get(d.uploaded_by as string) ?? "—"}, ${formatDateTime(d.created_at as string, ctx.profile.timezone)}`, d.superseded_at ? "superseded by a newer revision" : null].filter(Boolean).join(" · ")}
        actions={canEdit ? (
          <InlineActionForm action={archiveDrawing}>
            <input type="hidden" name="id" value={d.id} />
            <button type="submit" className="text-sm text-ink-muted underline">Remove</button>
          </InlineActionForm>
        ) : undefined}
      />
      {others.length ? <p className="text-sm">Other revisions: {others.map((o) => <Link key={o.id} href={`${base}/drawings/${o.id}`} className="mr-2 underline">{o.revision ? `rev ${o.revision}` : "earlier"}</Link>)}</p> : null}
      <DrawingMarkup projectId={id} drawingId={drawingId} url={signed.signedUrl} fileName={d.file_name as string} canLog={canLog}
        layers={(layers ?? []) as Layer[]} cables={(cables ?? []) as Cable[]} racks={(racks ?? []) as MarkupRack[]}
        panels={[...new Set((loadPanels ?? []).map((l) => String(l.panel).trim()).filter((p) => p && !/^(unassigned|none|n\/a|-)$/i.test(p)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))} exportHref={`${base}/drawings/${drawingId}/export`}
        markers={(markers ?? []).map((m) => ({ ...m, x: Number(m.x), y: Number(m.y) })) as Marker[]}
        devices={(devices ?? []) as MarkupDevice[]}
        keypads={(keypads ?? []).map((k) => {
          const parts = String(k.path).split("\\").map((x) => x.trim()).filter(Boolean);
          return { id: k.id, label: parts.slice(1, -1).join(" · ") || parts.join(" · "), model: k.model, integration_id: k.integration_id } as MarkupKeypad;
        })} />
    </div>
  );
}
