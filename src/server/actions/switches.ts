"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";
import { EQUIPMENT_FIELDS, PORT_FIELDS, fieldsSchema } from "@/lib/validation/site";

const text = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const watts = z.number().min(0).max(100000).nullable();
const done = () => revalidatePath("/o/[org]/projects/[id]/site", "layout");

const portQuick = z.object({
  ids: z.array(uuid).min(1).max(1000),
  fields: fieldsSchema(PORT_FIELDS),
  poe_w: watts.optional(),
}).refine((v) => v.poe_w !== undefined || (v.fields && Object.keys(v.fields).length), "Nothing to change.");

/** Typing into a port row, or a common VLAN / location / device… across many ports. */
export async function updatePorts(input: { ids: string[]; fields?: Partial<Record<string, string | null>>; poe_w?: number | null }): Promise<ActionResult> {
  const parsed = portQuick.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  const { ids, fields, poe_w } = parsed.data;
  const patch: Record<string, unknown> = { ...(fields ?? {}) };
  if ("port" in patch) {
    if (ids.length > 1) return { ok: false, error: "Each port needs its own name; change them one at a time." };
    if (!patch.port) return { ok: false, error: "A port needs a name, e.g. Gi1/0/1." };
  }
  if (poe_w !== undefined) patch.poe_w = poe_w;
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_ports").update(patch).in("id", ids).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change these ports.") };
  done();
  return { ok: true, message: data.length === 1 ? "Saved." : `${data.length} ports updated.` };
}

const eqQuick = z.object({ id: uuid, fields: fieldsSchema(EQUIPMENT_FIELDS), poe_total_w: watts.optional() });

/** Switch details (name, model, IP, firmware, PoE budget…). Renaming moves its ports with it. */
export async function updateEquipment(input: { id: string; fields?: Partial<Record<string, string | null>>; poe_total_w?: number | null }): Promise<ActionResult> {
  const parsed = eqQuick.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  const { id, fields, poe_total_w } = parsed.data;
  const patch: Record<string, unknown> = { ...(fields ?? {}) };
  if (poe_total_w !== undefined) patch.poe_total_w = poe_total_w;
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to change." };
  if ("sheet" in patch && !patch.sheet) return { ok: false, error: "The switch needs a name." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("site_equipment").select("project_id, sheet").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "Switch not found." };
  const { error } = await supabase.from("site_equipment").update(patch).eq("id", id);
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change this switch.") };
  if (patch.sheet && patch.sheet !== before.sheet) {
    const { error: e2 } = await supabase.from("site_ports").update({ equipment: patch.sheet }).eq("project_id", before.project_id).eq("equipment", before.sheet);
    if (e2) return { ok: false, error: friendlyDbError(e2, "The switch was renamed but its ports couldn't be moved. Try again.") };
  }
  done();
  return { ok: true, message: "Saved." };
}

/** Port names from a pattern: "Gi1/0/" 1–24 → Gi1/0/1 … Gi1/0/24 (padded like the first number typed). */
function portNames(prefix: string, from: number, to: number, pad: number) {
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${prefix}${String(n).padStart(pad, "0")}`);
  return out;
}

const portRange = {
  prefix: z.string().trim().max(30).default(""),
  from: z.coerce.number().int().min(0).max(999),
  to: z.coerce.number().int().min(0).max(999),
  pad: z.coerce.number().int().min(1).max(3).default(1),
};

async function insertPorts(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string, sheet: string, names: string[]) {
  const { data: last } = await supabase.from("site_ports").select("position").eq("project_id", projectId).eq("equipment", sheet).order("position", { ascending: false }).limit(1);
  const start = Number(last?.[0]?.position ?? 0) + 1;
  return supabase.from("site_ports").upsert(
    names.map((port, i) => ({ project_id: projectId, equipment: sheet, port, position: start + i })),
    { onConflict: "project_id,equipment,port", ignoreDuplicates: true },
  ).select("id");
}

const newSwitch = z.object({
  projectId: uuid,
  sheet: z.string().trim().min(1, "Give it a name, e.g. LEC 403 Sw3.").max(80),
  title: text(200), model: text(120), hostname: text(80), ip: text(80), location: text(80),
  poe_total_w: z.union([z.literal(""), z.coerce.number().min(0).max(100000)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  portsFrom: z.union([z.literal(""), z.coerce.number().int().min(0).max(999)]).optional(),
  portsTo: z.union([z.literal(""), z.coerce.number().int().min(0).max(999)]).optional(),
  prefix: z.string().trim().max(30).default(""),
});

/** Adds a switch, router, firewall or PBX by hand, with its ports if a range is given. */
export async function addSwitch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = newSwitch.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { projectId, portsFrom, portsTo, prefix, ...eq } = parsed.data;
  const from = portsFrom === "" || portsFrom === undefined ? null : portsFrom;
  const to = portsTo === "" || portsTo === undefined ? null : portsTo;
  if ((from === null) !== (to === null) || (from !== null && to !== null && (to < from || to - from >= 200))) return { ok: false, error: "Ports: give the first and last number (up to 200 ports)." };
  const supabase = await createClient();
  const { error } = await supabase.from("site_equipment").insert({ ...eq, project_id: projectId });
  if (error) return { ok: false, error: error.code === "23505" ? "A switch with that name already exists in this project." : friendlyDbError(error, "You can't add switches to this project.") };
  let n = 0;
  if (from !== null && to !== null) {
    const { data, error: e2 } = await insertPorts(supabase, projectId, eq.sheet, portNames(prefix, from, to, 1));
    if (e2) return { ok: false, error: friendlyDbError(e2, "The switch was added but its ports weren't.") };
    n = data?.length ?? 0;
  }
  done();
  return { ok: true, message: `${eq.sheet} added${n ? ` with ${n} ports` : ""}.` };
}

const addPortsSchema = z.object({ projectId: uuid, sheet: z.string().trim().min(1).max(80), ...portRange });

/** Adds ports to a switch: one ("Gi1/0/49", from = to) or a run ("Te1/1/" 1–4). Existing names are skipped. */
export async function addPorts(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = addPortsSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { projectId, sheet, prefix, from, to, pad } = parsed.data;
  if (to < from || to - from >= 200) return { ok: false, error: "Give the first and last port number (up to 200 at a time)." };
  if (!prefix && from === to && from === 0) return { ok: false, error: "Type the port name or a range." };
  const supabase = await createClient();
  const { data, error } = await insertPorts(supabase, projectId, sheet, portNames(prefix, from, to, pad));
  if (error) return { ok: false, error: friendlyDbError(error, "You can't add ports to this switch.") };
  done();
  const n = data?.length ?? 0;
  return { ok: true, message: n ? `${n} port${n === 1 ? "" : "s"} added.` : "Those ports already exist." };
}

/** Removes ports, or a whole switch with its ports (hidden, kept in the history). Project manager only. */
export async function removeSwitchRows(input: { kind: "ports" | "switch"; ids: string[] }): Promise<ActionResult> {
  const parsed = z.object({ kind: z.enum(["ports", "switch"]), ids: z.array(uuid).min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose what to remove." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  if (parsed.data.kind === "ports") {
    const { data, error } = await supabase.from("site_ports").update({ archived_at: now }).in("id", parsed.data.ids).is("archived_at", null).select("id");
    if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "Only the project manager can remove ports.") };
    done();
    return { ok: true, message: `${data.length} port${data.length === 1 ? "" : "s"} removed.` };
  }
  const { data: eq, error } = await supabase.from("site_equipment").update({ archived_at: now }).eq("id", parsed.data.ids[0]).is("archived_at", null).select("project_id, sheet").maybeSingle();
  if (error || !eq) return { ok: false, error: friendlyDbError(error, "Only the project manager can remove a switch.") };
  await supabase.from("site_ports").update({ archived_at: now }).eq("project_id", eq.project_id).eq("equipment", eq.sheet).is("archived_at", null);
  done();
  return { ok: true, message: `${eq.sheet} removed.` };
}
