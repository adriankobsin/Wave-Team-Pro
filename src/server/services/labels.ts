import "server-only";
import { createClient } from "@/lib/supabase/server";

export type LabelTarget = { key: string; kind: string; title: string; detail: string; path: string };
export type LabelGroup = { id: string; title: string; hint: string; items: LabelTarget[] };

/** "552-R2 - NETWORK RACK" → "552-R2"; patch panels such as "MEC552-R2-PP1" contain this code. */
export const rackCode = (name: string) => name.split(" - ")[0].trim();
/** Room number a rack sits in ("552-R2" → "552"), which switch sheets name ("MEC 552 Core Sw1"). */
export const rackRoom = (name: string) => /^(\d+)/.exec(rackCode(name))?.[1] ?? null;

async function all<T>(build: (from: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await build(from);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Everything in a project that can carry a QR sticker, with where its code leads (relative to the
 * project): the project itself, racks, patch panels, switches, lighting panels and drawings.
 */
export async function labelTargets(projectId: string, projectName: string): Promise<LabelGroup[]> {
  const supabase = await createClient();
  const [{ data: racks }, { data: items }, cables, { data: switches }, ports, loads, { data: drawings }] = await Promise.all([
    supabase.from("site_racks").select("id, name, units, location").eq("project_id", projectId).is("archived_at", null).order("name"),
    supabase.from("site_rack_items").select("rack_id").eq("project_id", projectId).limit(5000),
    all<{ patch_panel: string; label: string | null; test_result: string }>((f) => supabase.from("site_cables").select("patch_panel, label, test_result").eq("project_id", projectId).is("archived_at", null).order("id").range(f, f + 999)),
    supabase.from("site_equipment").select("sheet, title, model, location").eq("project_id", projectId).is("archived_at", null).order("sheet"),
    all<{ equipment: string; end_device: string | null }>((f) => supabase.from("site_ports").select("equipment, end_device").eq("project_id", projectId).is("archived_at", null).order("id").range(f, f + 999)),
    all<{ panel: string | null; module: string | null }>((f) => supabase.from("lighting_loads").select("panel, module").eq("project_id", projectId).is("archived_at", null).order("id").range(f, f + 999)),
    supabase.from("project_drawings").select("id, title, number, revision, discipline").eq("project_id", projectId).is("archived_at", null).is("superseded_at", null).order("title"),
  ]);
  const enc = encodeURIComponent;
  const panels = [...new Set(cables.map((c) => c.patch_panel))].sort();
  const lighting = [...new Set(loads.map((l) => l.panel).filter((x): x is string => Boolean(x) && x !== "Unassigned"))].sort();

  return [
    { id: "project", title: "Project", hint: "Opens a PDF of every site schedule and the rack elevations for the project.", items: [{ key: "project", kind: "Project", title: projectName, detail: "Project documents and schedules", path: "" }] },
    {
      id: "racks", title: "Racks", hint: "Opens a PDF of the rack: what's in each U, its patch panels with their schedules, and the switches in that room.",
      items: (racks ?? []).map((r) => {
        const code = rackCode(r.name as string);
        const pp = panels.filter((p) => p.includes(code)).length;
        return { key: `rack:${r.id}`, kind: "Rack", title: r.name as string, detail: [`${r.units}U`, `${(items ?? []).filter((i) => i.rack_id === r.id).length} items`, pp ? `${pp} patch panels` : null, r.location].filter(Boolean).join(" · "), path: `/site/racks/${r.id}` };
      }),
    },
    {
      id: "patch", title: "Patch panels", hint: "Opens a PDF of that panel's cable schedule: every port, cable number, room, device, test result and length.",
      items: panels.map((p) => {
        const list = cables.filter((c) => c.patch_panel === p);
        const used = list.filter((c) => c.label).length;
        return { key: `pp:${p}`, kind: "Patch panel", title: p, detail: `${list.length} ports · ${used} cables · ${list.filter((c) => c.test_result === "passed").length} passed`, path: `/site/cables?panel=${enc(p)}&all=1` };
      }),
    },
    {
      id: "switches", title: "Switches and network equipment", hint: "Opens a PDF of the switch: every port with VLAN, patch panel port, end device, PoE and IP.",
      items: (switches ?? []).map((s) => {
        const list = ports.filter((p) => p.equipment === s.sheet);
        return { key: `sw:${s.sheet}`, kind: "Switch", title: s.sheet as string, detail: [s.title, s.model, `${list.length} ports · ${list.filter((p) => p.end_device).length} in use`].filter(Boolean).join(" · "), path: `/site/switches?eq=${enc(s.sheet as string)}` };
      }),
    },
    {
      id: "lighting", title: "Lighting panels", hint: "Opens a PDF of everything connected to that lighting panel: modules, outputs, zones, fixtures and DALI addresses.",
      items: lighting.map((p) => {
        const list = loads.filter((l) => l.panel === p);
        return { key: `lp:${p}`, kind: "Lighting panel", title: p.split("\\").pop() ?? p, detail: `${p.split("\\")[0]} · ${list.length} loads · ${new Set(list.map((l) => l.module)).size} modules`, path: `/site/lighting?panel=${enc(p)}` };
      }),
    },
    {
      id: "drawings", title: "Drawings", hint: "Opens the drawing as a PDF with its layers and legend. If a newer revision is uploaded later, the sticker opens that one.",
      items: (drawings ?? []).map((d) => ({ key: `dr:${d.id}`, kind: "Drawing", title: [d.number, d.title].filter(Boolean).join(" ") as string, detail: d.revision ? `rev ${d.revision}` : "", path: `/drawings/${d.id}` })),
    },
  ].filter((g) => g.items.length);
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i look-alikes
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Short codes for QR stickers (reused when the same target was printed before). */
export async function shortLinks(projectId: string, targets: string[]): Promise<Map<string, string>> {
  const supabase = await createClient();
  const want = [...new Set(targets)];
  const out = new Map<string, string>();
  const load = async () => {
    for (let i = 0; i < want.length; i += 200) {
      const { data } = await supabase.from("qr_links").select("code, target").eq("project_id", projectId).in("target", want.slice(i, i + 200));
      for (const r of data ?? []) out.set(r.target as string, r.code as string);
    }
  };
  await load();
  const missing = want.filter((t) => !out.has(t));
  if (missing.length) {
    const { error } = await supabase.from("qr_links").insert(missing.map((target) => ({ code: newCode(), project_id: projectId, target })));
    if (error && error.code !== "23505") throw error;
    if (error) { // someone printed the same label at the same moment: insert one by one, ignoring clashes
      for (const target of missing) await supabase.from("qr_links").insert({ code: newCode(), project_id: projectId, target });
    }
    await load();
  }
  return out;
}
