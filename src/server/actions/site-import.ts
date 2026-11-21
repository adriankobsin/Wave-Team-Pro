"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation/common";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { panelPort, parseNetworkSheet, type ScheduleCable } from "@/lib/import/network-sheet";
import { pdfItems } from "@/lib/import/pdf-text";
import { parseIntegrationReport, parseLoadSchedule } from "@/lib/import/lutron";

export type ImportKind = "network" | "lutron_integration" | "lutron_loads" | "drawing";
const LIMITS: Record<ImportKind, { bytes: number; ext: string[] }> = {
  network: { bytes: 20 * 1024 * 1024, ext: ["xlsx"] },
  lutron_integration: { bytes: 40 * 1024 * 1024, ext: ["pdf"] },
  lutron_loads: { bytes: 40 * 1024 * 1024, ext: ["pdf"] },
  drawing: { bytes: 50 * 1024 * 1024, ext: ["pdf"] },
};

async function project(projectId: string) {
  const supabase = await createClient();
  const [{ data: p }, { data: canEdit }, { data: canLog }, { data: claims }] = await Promise.all([
    supabase.from("projects").select("id, organization_id").eq("id", projectId).maybeSingle(),
    supabase.rpc("can_edit_project", { p_project: projectId }),
    supabase.rpc("can_log_on_project", { p_project: projectId }),
    supabase.auth.getClaims(),
  ]);
  return { supabase, p: p as { id: string; organization_id: string } | null, canEdit: Boolean(canEdit), canLog: Boolean(canLog), userId: (claims?.claims?.sub as string) ?? null };
}

/** Step 1 of an upload: a one-time link to put the file straight into private storage (large files skip the server). */
export async function startSiteUpload(input: { projectId: string; kind: ImportKind; fileName: string; size: number }): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const parsed = z.object({ projectId: uuid, kind: z.enum(["network", "lutron_integration", "lutron_loads", "drawing"]), fileName: z.string().min(1).max(255), size: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a file." };
  const { kind, fileName, size, projectId } = parsed.data;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!LIMITS[kind].ext.includes(ext)) return { ok: false, error: `Choose a ${LIMITS[kind].ext.join(" or ").toUpperCase()} file.` };
  if (size > LIMITS[kind].bytes) return { ok: false, error: `That file is too large (max ${Math.round(LIMITS[kind].bytes / 1048576)} MB).` };
  const { p, canEdit, canLog } = await project(projectId);
  if (!p || !(kind === "drawing" ? canLog : canEdit)) return { ok: false, error: kind === "drawing" ? "Only the project team can add drawings." : "Only the project manager can import schedules." };
  const path = `${p.organization_id}/${kind === "drawing" ? "drawings" : "site-imports"}/${p.id}/${randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from("files").createSignedUploadUrl(path);
  if (error || !data) {
    logServerError("site.upload", error);
    return { ok: false, error: "The upload couldn't start. Try again." };
  }
  return { ok: true, path, token: data.token };
}

const ownPath = (orgId: string, projectId: string, path: string, folder: string) => path.startsWith(`${orgId}/${folder}/${projectId}/`) && !path.includes("..");

async function download(path: string) {
  const { data, error } = await createAdminClient().storage.from("files").download(path);
  if (error || !data) throw new Error("download failed");
  return new Uint8Array(await data.arrayBuffer());
}

type Row = Record<string, unknown>;
/** Inserts new rows and refreshes the descriptive fields of existing ones, leaving tests and statuses alone. */
async function merge(
  supabase: Awaited<ReturnType<typeof createClient>>, table: string, projectId: string, keyCols: string[],
  rows: Row[], keepOnUpdate: string[],
) {
  const keyOf = (r: Row) => keyCols.map((k) => String(r[k] ?? "")).join("\u0001");
  const existing = new Map<string, Row>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("*").eq("project_id", projectId).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as Row[]) existing.set(keyOf(r), r);
    if (!data || data.length < 1000) break;
  }
  const seen = new Set<string>();
  const unique = rows.filter((r) => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true; });
  const fresh = unique.filter((r) => !existing.has(keyOf(r))).map((r) => ({ ...r, project_id: projectId }));
  // On re-import the spreadsheet wins where it has a value; a blank cell keeps what was typed into the app.
  const old = unique.filter((r) => existing.has(keyOf(r))).map((r) => {
    const before = existing.get(keyOf(r))!;
    const o: Row = { project_id: projectId };
    for (const [k, v] of Object.entries(r)) {
      if (keepOnUpdate.includes(k)) continue;
      o[k] = (v === null || v === undefined || v === "") && before[k] !== undefined ? before[k] : v;
    }
    return o;
  });
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await supabase.from(table).insert(fresh.slice(i, i + 500));
    if (error) throw error;
  }
  for (let i = 0; i < old.length; i += 500) {
    const { error } = await supabase.from(table).upsert(old.slice(i, i + 500), { onConflict: ["project_id", ...keyCols].join(",") });
    if (error) throw error;
  }
  return { added: fresh.length, updated: old.length };
}

const yes = (v: string | null) => Boolean(v && /^(y|yes|ok|done|pass|passed|x|✓|✔|true|1)$/i.test(v.trim()));
const metres = (v: string | null) => {
  const m = v ? /(\d+(?:\.\d+)?)/.exec(v) : null;
  return m ? Number(m[1]) : null;
};
const normLabel = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * A cable schedule (From / To layout) fills in the project's cables by cable number. A cable already
 * on the platform keeps its patch panel and port (a different one in the schedule is noted on it);
 * a new one is added at the schedule's patch panel port. Blank cells never overwrite.
 */
async function mergeSchedule(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string, rows: ScheduleCable[], fileName: string) {
  const existing: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("site_cables").select("*").eq("project_id", projectId).is("archived_at", null).order("id").range(from, from + 999);
    if (error) throw error;
    existing.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const byLabel = new Map(existing.filter((r) => r.label).map((r) => [normLabel(r.label as string), r]));
  const bySlot = new Map(existing.map((r) => [`${String(r.patch_panel).toUpperCase()}#${r.port}`, r]));
  let added = 0; let updated = 0;
  const skipped: string[] = [];
  for (const s of rows) {
    const to = [s.to.deck, s.to.room, s.to.equipment, s.to.port].filter(Boolean).join(" ");
    const lengthM = metres(s.length) ?? metres(s.from.length);
    const tested = yes(s.tested);
    const terminated = yes(s.terminated);
    const extra = [s.description, to ? `To: ${to}` : null, s.tail ? `Tail ${s.tail}` : null].filter(Boolean).join(" · ") || null;
    const slot = panelPort(s.from.port) ?? panelPort(s.to.port);
    const fields: Row = {
      cable_type: s.cableType, system: s.system, deck: s.from.deck, room: s.from.room, location: s.from.location, device_name: s.from.equipment,
      ...(lengthM !== null ? { length_m: lengthM } : {}),
      ...(terminated || tested ? { installed: true } : {}),
      ...(tested ? { test_result: "passed", tested_by_name: s.engineer ?? `Imported from ${fileName}` } : s.engineer ? { tested_by_name: s.engineer } : {}),
      ...(s.to.equipment || s.to.port ? { switch_port: [s.to.equipment, s.to.port].filter(Boolean).join(" ") } : {}),
    };
    const hit = byLabel.get(normLabel(s.label));
    if (hit) {
      const patch: Row = {};
      for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== "" && (hit[k] === null || hit[k] === undefined || hit[k] === "" || ["length_m", "installed", "test_result", "tested_by_name", "switch_port"].includes(k))) patch[k] = v;
      const differs = slot && (slot.port !== hit.port || !String(hit.patch_panel).toUpperCase().endsWith(slot.panel.replace(/^patch panel\s*/i, "").toUpperCase()));
      const note = [extra, differs ? `Cable schedule: ${s.from.port}` : null].filter(Boolean).join(" · ");
      if (note && !String(hit.notes ?? "").includes(note)) patch.notes = [hit.notes, note].filter(Boolean).join(" · ").slice(0, 4000);
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("site_cables").update(patch).eq("id", hit.id as string);
        if (error) throw error;
        updated++;
      }
      continue;
    }
    if (!slot) { skipped.push(`${s.label} has no patch panel port`); continue; }
    const key = `${slot.panel.toUpperCase()}#${slot.port}`;
    const clash = bySlot.get(key);
    if (clash) { skipped.push(`${s.label}: ${slot.panel} port ${slot.port} is already ${clash.label ?? "used"}`); continue; }
    const { data, error } = await supabase.from("site_cables").insert({ project_id: projectId, label: s.label, patch_panel: slot.panel, port: slot.port, notes: extra, ...fields }).select("*").single();
    if (error) throw error;
    bySlot.set(key, data as Row);
    byLabel.set(normLabel(s.label), data as Row);
    added++;
  }
  return { added, updated, skipped };
}

/** Step 2: read the uploaded file and load it into the project. */
export async function runSiteImport(input: { projectId: string; kind: Exclude<ImportKind, "drawing">; path: string; fileName: string }): Promise<ActionResult> {
  const parsed = z.object({ projectId: uuid, kind: z.enum(["network", "lutron_integration", "lutron_loads"]), path: z.string().min(10).max(400), fileName: z.string().min(1).max(255) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Upload the file again." };
  const { projectId, kind, path, fileName } = parsed.data;
  const { supabase, p, canEdit, userId } = await project(projectId);
  if (!p || !canEdit || !ownPath(p.organization_id, p.id, path, "site-imports")) return { ok: false, error: "Only the project manager can import schedules." };
  try {
    const bytes = await download(path);
    let counts: Record<string, unknown> = {};
    if (kind === "network") {
      const n = await parseNetworkSheet(bytes);
      if (!n.devices.length && !n.cables.length && !n.ports.length && !n.schedule.length) return { ok: false, error: "This doesn't look like a network spreadsheet or cable schedule: no device list, patch panels, switch sheets or cable rows were found." };
      const occ = new Map<string, number>();
      const devices = n.devices.map((d) => {
        const k = (occ.get(d.name) ?? 0) + 1; occ.set(d.name, k);
        return { import_key: `${d.name}#${k}`, deck: d.deck, room: d.room, location: d.location, system: d.system, type: d.type, name: d.name, model: d.model ?? null, hostname: d.hostname ?? null, port: d.port, poe_w: d.poeW, mac: d.mac, serial: d.serial, ip: d.ip, firmware: d.firmware ?? null, switch_port: d.switchPort ?? null, type_code: d.typeCode, cable_label: d.cableLabel, patch_panel: d.patchPanel, patch_port: d.patchPort === null ? null : Math.round(d.patchPort), notes: d.notes };
      });
      const cables = n.cables.map((c) => ({
        label: c.label, rack: c.rack, patch_panel: c.patchPanel, port: Math.round(c.port), cable_type: c.cableType, system: c.system, deck: c.deck, room: c.room, location: c.location, switch_port: c.switchPort, device_name: c.deviceName,
        installed: c.installed || c.lengthM !== null, test_result: c.lengthM !== null ? "passed" : "not_tested", length_m: c.lengthM, tested_by_name: c.lengthM !== null ? `Imported from ${fileName}` : null, notes: c.notes,
      }));
      counts = {
        devices: await merge(supabase, "site_devices", p.id, ["import_key"], devices, ["status", "notes"]),
        cables: await merge(supabase, "site_cables", p.id, ["patch_panel", "port"], cables, ["installed", "test_result", "length_m", "tested_by_name", "notes"]),
        equipment: await merge(supabase, "site_equipment", p.id, ["sheet"], n.equipment.map((e) => ({ sheet: e.sheet, title: e.title, hostname: e.hostname, model: e.model, mac: e.mac, serial: e.serial, firmware: e.firmware, location: e.location, ip: e.ip, poe_total_w: e.poeTotalW })), []),
        ports: await merge(supabase, "site_ports", p.id, ["equipment", "port"], n.ports.map((x) => ({ equipment: x.equipment, port: x.port, position: x.position, vlan: x.vlan, patch_port: x.patchPort, end_location: x.endLocation, end_device: x.endDevice, poe_w: x.poeW, end_ip: x.endIp, notes: x.notes })), []),
        vlans: await merge(supabase, "site_vlans", p.id, ["vlan_id"], n.vlans.map((v) => ({ vlan_id: v.vlanId, name: v.name, ip_range: v.ipRange, subnet_mask: v.subnetMask, gateway: v.gateway, dns: v.dns, dhcp_scope: v.dhcpScope, notes: v.notes })), []),
        ips: await merge(supabase, "site_ips", p.id, ["address"], n.ips.map((x) => ({ vlan_id: x.vlanId, address: x.address, device_name: x.deviceName })), []),
        racks: await merge(supabase, "site_rack_units", p.id, ["rack", "unit"], n.racks.map((x) => ({ rack: x.rack, unit: x.unit, item: x.item })), []),
      };
      if (n.schedule.length) counts.schedule = await mergeSchedule(supabase, p.id, n.schedule, fileName);
      for (const k of Object.keys(counts)) { const c = counts[k] as { added: number; updated: number }; if (!c.added && !c.updated && k !== "schedule") delete counts[k]; }
    } else if (kind === "lutron_integration") {
      const items = parseIntegrationReport(await pdfItems(bytes));
      if (!items.length) return { ok: false, error: "No integration addresses were found. Export the Integration Report from Lutron Designer as PDF and try again." };
      counts = { items: await merge(supabase, "lutron_items", p.id, ["href"], items.map((i) => ({ kind: i.kind, path: i.path, href: i.href, integration_id: i.integrationId, model: i.model ?? null, component: i.component ?? null, component_name: i.componentName ?? null, device_href: i.deviceHref ?? null })), ["engraving", "notes"]) };
    } else {
      const { data: zones } = await supabase.from("lutron_items").select("path").eq("project_id", p.id).eq("kind", "zone");
      const loads = parseLoadSchedule(await pdfItems(bytes), new Set((zones ?? []).map((z) => z.path as string)));
      if (!loads.length) return { ok: false, error: "No loads were found. Export the Load Schedule from Lutron Designer as PDF and try again." };
      counts = { loads: await merge(supabase, "lighting_loads", p.id, ["area", "zone_name", "load_number"], loads.map((l) => ({ area: l.area, zone_number: l.zoneNumber, zone_name: l.zoneName, zone_description: l.zoneDescription, load_number: l.loadNumber, feed: l.feed || null, fixture: l.fixture, quantity: l.quantity, load_type: l.loadType, assigned_to: l.assignedTo, panel: l.panel, module: l.module, output: l.output, wattage: l.wattage })), ["status", "dali_address", "driver", "notes"]) };
    }
    const { data: linked } = await supabase.rpc("link_site_records", { p_project: p.id });
    if (kind === "network") await supabase.rpc("seed_rack_layout", { p_project: p.id });
    await supabase.from("site_imports").insert({ project_id: p.id, kind, file_name: fileName, counts: { ...counts, linked }, imported_by: userId });
    revalidatePath("/o/[org]/projects/[id]/site", "layout");
    const summary = Object.entries(counts).map(([k, v]) => {
      const c = v as { added: number; updated: number; skipped?: string[] };
      return `${k}: ${c.added} new, ${c.updated} updated${c.skipped?.length ? ` (${c.skipped.length} not added: ${c.skipped.slice(0, 6).join("; ")}${c.skipped.length > 6 ? "…" : ""})` : ""}`;
    }).join(" · ");
    return { ok: true, message: `Imported ${fileName}. ${summary}` };
  } catch (e) {
    logServerError("site.import", e);
    return { ok: false, error: friendlyDbError(e as { code?: string; message?: string }, "The file couldn't be imported. Check it's the right file and try again.") };
  }
}

const drawingSchema = z.object({
  projectId: uuid, path: z.string().min(10).max(400), fileName: z.string().min(1).max(255),
  title: z.string().trim().min(2, "Give the drawing a title").max(200),
  discipline: z.enum(["general", "lighting", "control", "av", "wifi", "data", "cctv", "access", "audio", "power", "other"]),
  number: z.string().trim().max(80).optional().transform((v) => v || null),
  revision: z.string().trim().max(20).optional().transform((v) => v || null),
  deck: z.string().trim().max(60).optional().transform((v) => v || null),
  supersedes: z.union([uuid, z.literal("")]).optional().transform((v) => v || null),
});

/** Step 2 for drawings: record the uploaded PDF (optionally as a new revision of an earlier one). */
export async function addDrawing(input: z.input<typeof drawingSchema>): Promise<ActionResult> {
  const parsed = drawingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  const { supabase, p, canLog, userId } = await project(d.projectId);
  if (!p || !canLog || !userId || !ownPath(p.organization_id, p.id, d.path, "drawings")) return { ok: false, error: "Only the project team can add drawings." };
  const folder = d.path.slice(0, d.path.lastIndexOf("/"));
  const name = d.path.slice(d.path.lastIndexOf("/") + 1);
  const { data: listed } = await createAdminClient().storage.from("files").list(folder, { search: name });
  const obj = listed?.find((o) => o.name === name);
  const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0);
  if (!obj || !size) return { ok: false, error: "The upload didn't finish. Try again." };
  const { data: row, error } = await supabase.from("project_drawings").insert({
    project_id: p.id, discipline: d.discipline, number: d.number, title: d.title, revision: d.revision, deck: d.deck,
    storage_path: d.path, file_name: d.fileName, size_bytes: size, uploaded_by: userId, supersedes: d.supersedes,
  }).select("id").single();
  if (error || !row) return { ok: false, error: friendlyDbError(error, "The drawing couldn't be saved.") };
  if (d.supersedes) await supabase.from("project_drawings").update({ superseded_at: new Date().toISOString() }).eq("id", d.supersedes).eq("project_id", p.id);
  revalidatePath("/o/[org]/projects/[id]/drawings", "layout");
  return { ok: true, message: `Saved ${d.title}${d.revision ? ` rev ${d.revision}` : ""}.` };
}

export async function archiveDrawing(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_drawings").update({ archived_at: new Date().toISOString() }).eq("id", id.data).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "Only the project manager or the uploader can remove a drawing.") };
  revalidatePath("/o/[org]/projects/[id]/drawings", "layout");
  return { ok: true, message: "Removed." };
}
