"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import { isDateString } from "@/lib/time";
import { friendlyDbError, type ActionResult } from "@/lib/errors";
import { CABLE_FIELDS, DEVICE_FIELDS, fieldsSchema } from "@/lib/validation/site";
import { projectTeam } from "@/server/services/site";

const text = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const optNum = z.union([z.literal(""), z.coerce.number().min(0).max(100000)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

async function me() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: (data?.claims?.sub as string | undefined) ?? null };
}

const cableSchema = z.object({
  id: uuid,
  label: text(120), cable_type: text(60), room: text(60), location: text(120), device_name: text(200), switch_port: text(80), notes: text(4000),
  installed: z.string().optional().transform((v) => v === "on"),
  test_result: z.enum(["not_tested", "passed", "failed", "needs_review", "retest"]),
  length_m: optNum,
  tested_on: z.string().optional().refine((v) => !v || isDateString(v), "Choose a date").transform((v) => v || null),
});

/** Saves a cable: its details and its test (result, length, date, who). */
export async function saveCable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = cableSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const testers = z.array(uuid).max(20).safeParse(formData.getAll("tested_by").filter((x) => typeof x === "string" && x));
  if (!testers.success) return { ok: false, error: "Pick people from this project's team." };
  const { supabase, userId } = await me();
  const { id, ...c } = parsed.data;
  const { data: before } = await supabase.from("site_cables").select("project_id, test_result, length_m, tested_on, tested_by_ids").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "Cable not found." };
  const team = new Set((await projectTeam(before.project_id as string)).map((m) => m.id));
  const picked = testers.data.filter((x, i, a) => a.indexOf(x) === i);
  const prev = (before.tested_by_ids as string[] | null) ?? [];
  if (picked.some((x) => !team.has(x) && !prev.includes(x))) return { ok: false, error: "Pick people from this project's team." };
  const testChanged = c.test_result !== before.test_result || c.length_m !== (before.length_m === null ? null : Number(before.length_m));
  const whoChanged = picked.join() !== prev.join();
  const patch: Record<string, unknown> = { ...c };
  if (c.test_result === "not_tested") {
    Object.assign(patch, { tested_on: null, tested_by: null, tested_by_ids: [] });
  } else if (testChanged || whoChanged || c.tested_on !== before.tested_on) {
    // Whoever records the test is "tested by" unless people were ticked; today unless another date was given.
    const ids = picked.length ? picked : [userId];
    Object.assign(patch, { tested_by_ids: ids, tested_by: ids[0], tested_on: c.tested_on ?? new Date().toISOString().slice(0, 10), tested_by_name: null, installed: true });
  }
  const { error } = await supabase.from("site_cables").update(patch).eq("id", id);
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change this cable.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: "Saved." };
}

const deviceSchema = z.object({
  id: uuid,
  status: z.enum(["planned", "delivered", "installed", "commissioned", "tested", "fault"]),
  name: z.string().trim().min(1).max(200), manufacturer: text(80), model: text(120), type: text(80), system: text(80), deck: text(80), room: text(80), location: text(120), ip: text(60), mac: text(40), serial: text(80),
  firmware: text(60), notes: text(4000),
});

export async function saveDevice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = deviceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { supabase, userId } = await me();
  const { id, ...d } = parsed.data;
  const { data: before } = await supabase.from("site_devices").select("status").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "Device not found." };
  const patch: Record<string, unknown> = { ...d };
  if (d.status !== before.status) Object.assign(patch, { status_by: userId, status_at: new Date().toISOString() });
  const { error } = await supabase.from("site_devices").update(patch).eq("id", id);
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change this device.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: "Saved." };
}

const loadSchema = z.object({
  id: uuid,
  status: z.enum(["planned", "delivered", "installed", "commissioned", "tested", "fault"]),
  dali_address: text(20), driver: text(120), notes: text(4000),
});

export async function saveLoad(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = loadSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { supabase, userId } = await me();
  const { id, ...l } = parsed.data;
  const { data: before } = await supabase.from("lighting_loads").select("status").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "Load not found." };
  const patch: Record<string, unknown> = { ...l };
  if (l.status !== before.status) Object.assign(patch, { status_by: userId, status_at: new Date().toISOString() });
  const { error } = await supabase.from("lighting_loads").update(patch).eq("id", id);
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change this load.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: "Saved." };
}

/** Bulk status for lighting loads (e.g. a whole area installed). */
export async function setLoadsStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ ids: z.array(uuid).min(1).max(500), status: z.enum(["planned", "delivered", "installed", "commissioned", "tested", "fault"]) })
    .safeParse({ ids: formData.getAll("ids"), status: formData.get("status") });
  if (!parsed.success) return { ok: false, error: "Tick at least one load." };
  const { supabase, userId } = await me();
  const { data, error } = await supabase.from("lighting_loads").update({ status: parsed.data.status, status_by: userId, status_at: new Date().toISOString() }).in("id", parsed.data.ids).select("id");
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change these loads.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: `${data?.length ?? 0} loads updated.` };
}

const lutronSchema = z.object({ id: uuid, engraving: text(200), component_name: text(200), notes: text(2000) });

export async function saveLutronItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = lutronSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { supabase } = await me();
  const { id, ...v } = parsed.data;
  const { data, error } = await supabase.from("lutron_items").update(v).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: "Saved." };
}

const RESULTS = ["not_tested", "passed", "failed", "needs_review", "retest"] as const;
const STATUSES = ["planned", "delivered", "installed", "commissioned", "tested", "fault"] as const;

const cableQuick = z.object({
  ids: z.array(uuid).min(1).max(1000),
  test_result: z.enum(RESULTS).optional(),
  length_m: z.number().min(0).max(100000).nullable().optional(),
  tested_by_ids: z.array(uuid).max(20).optional(),
  fields: fieldsSchema(CABLE_FIELDS),
}).refine((v) => v.test_result !== undefined || v.length_m !== undefined || v.tested_by_ids !== undefined || (v.fields && Object.keys(v.fields).length), "Nothing to change.");

/**
 * Inline / bulk cable update from the schedule table: test result (recorded as tested by you,
 * today), length, or any text column — for one cable or a common value across many.
 */
export async function updateCables(input: { ids: string[]; test_result?: string; length_m?: number | null; tested_by_ids?: string[]; fields?: Partial<Record<string, string | null>> }): Promise<ActionResult> {
  const parsed = cableQuick.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  const { supabase, userId } = await me();
  const { ids, test_result, length_m, tested_by_ids, fields } = parsed.data;
  const patch: Record<string, unknown> = { ...(fields ?? {}) };
  if ("label" in patch && ids.length > 1) return { ok: false, error: "Each cable needs its own number; change them one at a time." };
  if (length_m !== undefined) patch.length_m = length_m;
  if (test_result !== undefined) {
    patch.test_result = test_result;
    if (test_result === "not_tested") Object.assign(patch, { tested_on: null, tested_by: null, tested_by_ids: [], tested_by_name: null });
    else if (tested_by_ids === undefined) {
      // Keep whoever was already chosen; if nobody was, it's you.
      const { data: cur } = await supabase.from("site_cables").select("id, tested_by_ids").in("id", ids);
      const empty = (cur ?? []).filter((c) => !(c.tested_by_ids as string[] | null)?.length).map((c) => c.id as string);
      Object.assign(patch, { tested_on: new Date().toISOString().slice(0, 10), tested_by_name: null, installed: true });
      if (empty.length && empty.length < ids.length) {
        const { error } = await supabase.from("site_cables").update({ tested_by: userId, tested_by_ids: [userId] }).in("id", empty);
        if (error) return { ok: false, error: friendlyDbError(error, "You can't change these cables.") };
      } else if (empty.length) Object.assign(patch, { tested_by: userId, tested_by_ids: [userId] });
    }
  }
  if (tested_by_ids !== undefined) {
    const team = new Set((await projectTeamOfCables(supabase, ids)).map((m) => m.id));
    if (tested_by_ids.some((x) => !team.has(x))) return { ok: false, error: "Pick people from this project's team." };
    Object.assign(patch, { tested_by_ids, tested_by: tested_by_ids[0] ?? null, tested_by_name: null });
    if (tested_by_ids.length && test_result === undefined) patch.tested_on = new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await supabase.from("site_cables").update(patch).in("id", ids).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change these cables.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: data.length === 1 ? "Saved." : `${data.length} cables updated.` };
}

/** Team of the project these cables belong to (all must be in one project). */
async function projectTeamOfCables(supabase: Awaited<ReturnType<typeof me>>["supabase"], ids: string[]) {
  const { data } = await supabase.from("site_cables").select("project_id").in("id", ids);
  const projects = [...new Set((data ?? []).map((c) => c.project_id as string))];
  if (projects.length !== 1) return [];
  return projectTeam(projects[0]);
}

const deviceQuick = z.object({ ids: z.array(uuid).min(1).max(1000), fields: fieldsSchema(DEVICE_FIELDS) });

/** Inline / bulk device text edits (a common room, deck, manufacturer… across many). */
export async function updateDevices(input: { ids: string[]; fields: Partial<Record<string, string | null>> }): Promise<ActionResult> {
  const parsed = deviceQuick.safeParse(input);
  if (!parsed.success || !parsed.data.fields || !Object.keys(parsed.data.fields).length) return { ok: false, error: parsed.success ? "Nothing to change." : parsed.error.issues[0]?.message ?? "Check the values." };
  const { ids, fields } = parsed.data;
  if ("name" in fields && !fields.name) return { ok: false, error: "A device needs a name." };
  const { supabase } = await me();
  const { data, error } = await supabase.from("site_devices").update(fields).in("id", ids).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change these devices.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: data.length === 1 ? "Saved." : `${data.length} devices updated.` };
}

const newDevice = z.object({
  projectId: uuid,
  name: z.string().trim().min(1, "Give the device a name.").max(200),
  manufacturer: text(80), model: text(120), type: text(80), system: text(80), deck: text(80), room: text(80), location: text(120),
  ip: text(60), mac: text(40), serial: text(80), notes: text(4000),
  status: z.enum(STATUSES).default("planned"),
});

/** Adds a device by hand (not from the spreadsheet); re-importing the spreadsheet leaves it alone. */
export async function addDevice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = newDevice.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { supabase } = await me();
  const { projectId, ...d } = parsed.data;
  const { error } = await supabase.from("site_devices").insert({ ...d, project_id: projectId, import_key: `manual:${crypto.randomUUID()}` });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't add devices to this project.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: `${d.name} added.` };
}

/** Removes devices or cables from the project (kept in the history, hidden from lists). Project manager only. */
export async function removeSiteRows(input: { table: "site_devices" | "site_cables"; ids: string[] }): Promise<ActionResult> {
  const parsed = z.object({ table: z.enum(["site_devices", "site_cables"]), ids: z.array(uuid).min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Tick what to remove." };
  const { supabase } = await me();
  const { data, error } = await supabase.from(parsed.data.table).update({ archived_at: new Date().toISOString() }).in("id", parsed.data.ids).is("archived_at", null).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "Only the project manager can remove these.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: `${data.length} removed.` };
}

/** Inline / bulk device status from the devices table. */
export async function updateDevicesStatus(input: { ids: string[]; status: string }): Promise<ActionResult> {
  const parsed = z.object({ ids: z.array(uuid).min(1).max(1000), status: z.enum(STATUSES) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a status." };
  const { supabase, userId } = await me();
  const { data, error } = await supabase.from("site_devices")
    .update({ status: parsed.data.status, status_by: userId, status_at: new Date().toISOString() }).in("id", parsed.data.ids).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change these devices.") };
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message: data.length === 1 ? "Saved." : `${data.length} devices updated.` };
}
