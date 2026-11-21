"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";

const KINDS = ["equipment", "patch_panel", "brush", "switch", "ups", "pdu", "shelf", "blank", "fan", "other"] as const;
const opt = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const done = (message: string, extra?: Record<string, unknown>): ActionResult & Record<string, unknown> => {
  revalidatePath("/o/[org]/projects/[id]/site", "layout");
  return { ok: true, message, ...extra };
};

/** Adds an empty rack (e.g. a new comms cabinet) to the project. */
export async function addRack(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    projectId: uuid,
    name: z.string().trim().min(1, "Name the rack.").max(80),
    units: z.coerce.number().int().min(1, "At least 1U.").max(60, "At most 60U."),
    location: z.string().trim().max(120).optional().transform((v) => v || null),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { projectId, ...r } = parsed.data;
  const { error } = await supabase.from("site_racks").insert({ ...r, project_id: projectId });
  if (error) return { ok: false, error: error.code === "23505" ? "There's already a rack with that name." : friendlyDbError(error, "You can't add racks to this project.") };
  return done(`${r.name} added.`);
}

/** Renames a rack or changes its height / location. */
export async function updateRack(input: { id: string; name?: string; units?: number; location?: string | null }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, name: z.string().trim().min(1).max(80).optional(), units: z.number().int().min(1).max(60).optional(), location: opt(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the rack name and height (1–60U)." };
  const supabase = await createClient();
  const { id, ...patch } = parsed.data;
  if (patch.units !== undefined) {
    const { data: high } = await supabase.from("site_rack_items").select("label, u_bottom, u_size").eq("rack_id", id).order("u_bottom", { ascending: false }).limit(50);
    const over = (high ?? []).find((i) => (i.u_bottom as number) + (i.u_size as number) - 1 > patch.units!);
    if (over) return { ok: false, error: `${over.label} sits above ${patch.units}U; move it down first.` };
  }
  const { data, error } = await supabase.from("site_racks").update(patch).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: error?.code === "23505" ? "There's already a rack with that name." : friendlyDbError(error, "You can't change this rack.") };
  return done("Saved.");
}

/** Removes a rack and everything placed in it. Project manager only. */
export async function removeRack(input: { id: string }): Promise<ActionResult> {
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Rack not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_racks").update({ archived_at: new Date().toISOString() }).eq("id", input.id).is("archived_at", null).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "Only the project manager can remove a rack.") };
  return done("Rack removed.");
}

const itemFields = {
  label: z.string().trim().min(1, "Give it a name.").max(120),
  kind: z.enum(KINDS),
  u_size: z.number().int().min(1, "At least 1U.").max(20, "At most 20U."),
  u_bottom: z.number().int().min(1),
  manufacturer: opt(80), model: opt(120), notes: opt(2000),
  device_id: uuid.nullable().optional(),
};

/** Puts something into a rack: a project device, or a shelf, blank, patch panel… */
export async function placeRackItem(input: { projectId: string; rackId: string; label: string; kind: string; u_size: number; u_bottom: number; manufacturer?: string | null; model?: string | null; device_id?: string | null }): Promise<ActionResult & { id?: string }> {
  const parsed = z.object({ projectId: uuid, rackId: uuid, ...itemFields }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the item." };
  const supabase = await createClient();
  const { projectId, rackId, ...i } = parsed.data;
  const { data, error } = await supabase.from("site_rack_items").insert({ ...i, project_id: projectId, rack_id: rackId }).select("id").single();
  if (error || !data) return { ok: false, error: friendlyDbError(error, "You can't change this rack.") };
  return done(`${i.label} placed.`, { id: data.id as string });
}

/** Moves (to another U or rack), resizes or renames an item. */
export async function updateRackItem(input: { id: string; rackId?: string; label?: string; kind?: string; u_size?: number; u_bottom?: number; manufacturer?: string | null; model?: string | null; notes?: string | null; device_id?: string | null }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, rackId: uuid.optional(), ...Object.fromEntries(Object.entries(itemFields).map(([k, v]) => [k, (v as z.ZodType).optional()])) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the item." };
  const supabase = await createClient();
  const { id, rackId, ...patch } = parsed.data as { id: string; rackId?: string } & Record<string, unknown>;
  const clean = Object.fromEntries(Object.entries({ ...patch, ...(rackId ? { rack_id: rackId } : {}) }).filter(([, v]) => v !== undefined));
  const { data, error } = await supabase.from("site_rack_items").update(clean).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this rack.") };
  return done("Saved.");
}

/** Takes an item out of the rack (the device itself stays in the project). */
export async function deleteRackItem(input: { id: string }): Promise<ActionResult> {
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Item not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_rack_items").delete().eq("id", input.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this rack.") };
  return done("Taken out of the rack.");
}
