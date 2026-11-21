import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stampDataFor } from "@/server/services/drawing-stamp-data";
import { getProjectLogo } from "@/server/services/branding";
import { stampDrawing } from "@/lib/drawings/stamp";
import { logServerError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The drawing as a PDF with the chosen layers marked on it (dots, tags, labels and a legend).
 * Anyone who can open the drawing can download it. ?layers=id,id (default: every layer);
 * ?legend=key for only the symbol key instead of the full device legend; ?inline=1 opens it in the
 * browser instead of downloading (QR stickers).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; id: string; drawingId: string }> }) {
  const { org, id, drawingId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(drawingId).success) return new NextResponse("Not found", { status: 404 });
  const ctx = await getOrgContext(org);
  const supabase = await createClient();
  // The viewer's own session decides what they can see (RLS); the file itself is then read with the service key.
  const { data: d } = await supabase.from("project_drawings").select("id, title, number, revision, storage_path, file_name, organization_id, projects(name)")
    .eq("id", drawingId).eq("project_id", id).is("archived_at", null).maybeSingle();
  if (!d || d.organization_id !== ctx.org.id) return new NextResponse("Not found", { status: 404 });

  const wanted = (req.nextUrl.searchParams.get("layers") ?? "").split(",").filter((x) => z.uuid().safeParse(x).success);
  const legend = req.nextUrl.searchParams.get("legend") === "key" ? "key" : "full";
  const [{ layers, markers, cables, stampLayers }, logo] = await Promise.all([stampDataFor(supabase, drawingId, wanted), getProjectLogo(id)]);
  const { data: file, error } = await createAdminClient().storage.from("files").download(d.storage_path as string);
  if (error || !file) { logServerError("drawing.export.download", error); return new NextResponse("The drawing file couldn't be read.", { status: 502 }); }

  const project = (d.projects as unknown as { name: string } | null)?.name ?? "";
  const drawingName = [d.number, d.title, d.revision ? `rev ${d.revision}` : null].filter(Boolean).join(" ");
  const title = `${project} · ${drawingName}`.slice(0, 160);

  try {
    const out = await stampDrawing(new Uint8Array(await file.arrayBuffer()), markers, stampLayers, title, { legend, cables, logo });
    const base = String(d.file_name).replace(/\.pdf$/i, "");
    const suffix = (layers ?? []).length === 1 ? (layers![0].name as string) : `${(layers ?? []).length} layers`;
    const name = `${base} - ${suffix}.pdf`.replace(/[^\w .,()&+-]/g, "_");
    return new NextResponse(Buffer.from(out), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${req.nextUrl.searchParams.get("inline") ? "inline" : "attachment"}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    logServerError("drawing.export.stamp", e);
    return new NextResponse("The drawing couldn't be marked up. Try downloading fewer layers, or the original PDF.", { status: 500 });
  }
}
