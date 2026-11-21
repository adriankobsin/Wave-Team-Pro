import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { LABEL_SHEETS, labelsPdf, type LabelSheet } from "@/lib/export/labels";
import { getProjectLogo } from "@/server/services/branding";
import { labelTargets, shortLinks } from "@/server/services/labels";

export const dynamic = "force-dynamic";

/** QR sticker sheet (PDF) for the ticked racks, patch panels, switches, lighting panels and drawings. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, name, organization_id").eq("id", id).maybeSingle();
  if (!project || project.organization_id !== ctx.org.id) return new NextResponse("Not found", { status: 404 });

  const wanted = new Set(req.nextUrl.searchParams.getAll("i"));
  const copies = Math.min(10, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("copies") ?? "1", 10) || 1));
  const sheetParam = req.nextUrl.searchParams.get("sheet");
  const sheet: LabelSheet = sheetParam && sheetParam in LABEL_SHEETS ? (sheetParam as LabelSheet) : "small";
  const groups = await labelTargets(id, project.name as string);
  const chosen = groups.flatMap((g) => g.items).filter((t) => wanted.has(t.key));
  if (!chosen.length) return new NextResponse("Tick at least one label.", { status: 400 });
  // Short links (/q/abcd2345) keep the QR codes small and easy to scan on a printed sticker.
  const codes = await shortLinks(id, chosen.map((t) => t.path));
  const url = (path: string) => (codes.get(path) ? `${req.nextUrl.origin}/q/${codes.get(path)}` : `${req.nextUrl.origin}/o/${ctx.org.slug}/projects/${id}${path}`);
  const labels = chosen.flatMap((t) => Array.from({ length: copies }, () => ({ kind: t.kind, title: t.title, detail: t.detail, project: String(project.name), url: url(t.path) })));
  const pdf = await labelsPdf(labels, sheet, await getProjectLogo(id));
  const file = `${String(project.name).replace(/[^A-Za-z0-9-]+/g, "-")}-QR-labels.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${file}"`, "cache-control": "private, no-store" } });
}
