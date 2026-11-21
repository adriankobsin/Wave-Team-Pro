import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildHandover, type HandoverDevice, type PartKey, type ScopeKey } from "@/lib/handover/build";
import { loadProjectReport } from "@/server/services/project-report";
import type { Logo } from "@/server/services/branding";

export type HandoverOptions = { signBy: "system" | "area"; preTick: boolean; client: string; scope?: ScopeKey[]; parts?: Partial<Record<PartKey, boolean>>; only?: string[] };

/** The client handover document (PDF) for one project: equipment list, per-system function, tick boxes and sign-off blocks. */
export async function buildProjectHandover(projectId: string, opts: HandoverOptions, logo: Logo | null, tz: string) {
  const r = await loadProjectReport(projectId, tz);
  if (!r) return null;
  const supabase = await createClient();
  const devices: HandoverDevice[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase.from("site_devices").select("deck, room, location, system, type, name, model, serial, status")
      .eq("project_id", projectId).is("archived_at", null).order("deck").order("room").order("name").range(from, from + 999);
    devices.push(...((data ?? []) as HandoverDevice[]));
    if (!data || data.length < 1000) break;
  }
  const only = opts.only?.length ? new Set(opts.only) : null;
  const shown = only ? devices.filter((d) => only.has(d.system || "Other equipment")) : devices;
  const p = r.project;
  const bytes = await buildHandover({
    company: p.company, project: p.name, client: opts.client.trim() || null, site: [p.site, p.country].filter(Boolean).join(", ") || null,
    manager: p.manager === "—" ? null : p.manager, generated: r.generated, devices: shown, signBy: opts.signBy, preTick: opts.preTick, scope: opts.scope, parts: opts.parts,
  }, logo);
  return { bytes, name: `${p.name} - Handover document.pdf`.replace(/[^A-Za-z0-9 ._-]+/g, ""), count: shown.length };
}
