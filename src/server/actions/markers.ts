"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";
import { MARKER_KINDS, MARKER_LAYER_NAMES } from "@/lib/site-constants";

const KINDS = ["keypad", "touch_panel", "access_point", "speaker", "subwoofer", "tv", "camera", "sensor", "data_point", "intercom", "phone", "light", "shade", "lighting_panel", "rack", "other"] as const;
const pos = z.number().min(0).max(1);
const fields = {
  kind: z.enum(KINDS),
  label: z.string().trim().min(1, "Give it a label.").max(120),
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  device_id: uuid.nullable().optional(),
  lutron_item_id: uuid.nullable().optional(),
  rack_id: uuid.nullable().optional(),
};
// These actions don't revalidate: the drawing page keeps its own state while you work and refreshes
// itself once saving goes quiet, so a save never redraws the sheet under the pointer.

/** Places a keypad, touch panel, access point, speaker… on a drawing. */
export async function addMarker(input: { id?: string; projectId: string; drawingId: string; layerId?: string | null; page: number; x: number; y: number; kind: string; label: string; device_id?: string | null; lutron_item_id?: string | null; rack_id?: string | null }): Promise<ActionResult & { id?: string; layerId?: string }> {
  const parsed = z.object({ id: uuid.optional(), projectId: uuid, drawingId: uuid, layerId: uuid.nullable().optional(), page: z.number().int().min(1), x: pos, y: pos, ...fields }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the marker." };
  const supabase = await createClient();
  const { projectId, drawingId, layerId, ...m } = parsed.data;
  let layer = layerId ?? null;
  if (!layer) {
    // No layer chosen: use (or start) the layer for this type, e.g. "Access points".
    const name = MARKER_LAYER_NAMES[m.kind];
    const { data: found } = await supabase.from("drawing_layers").select("id").eq("drawing_id", drawingId).ilike("name", name).maybeSingle();
    if (found) layer = found.id as string;
    else {
      const made = await createLayer({ projectId, drawingId, name, kind: m.kind, color: MARKER_KINDS[m.kind].color });
      if (!made.ok || !made.id) return { ok: false, error: made.ok ? "Couldn't start a layer." : made.error };
      layer = made.id;
    }
  }
  const { data, error } = await supabase.from("drawing_markers").insert({ ...m, layer_id: layer, project_id: projectId, drawing_id: drawingId }).select("id").single();
  if (error || !data) return { ok: false, error: friendlyDbError(error, "You can't mark up this drawing.") };
  return { ok: true, message: `${m.label} placed.`, id: data.id as string, layerId: layer };
}

/** Moves a marker, or changes its label, type, link or notes. */
export async function updateMarker(input: { id: string; layer_id?: string; x?: number; y?: number; kind?: string; label?: string; notes?: string | null; device_id?: string | null; lutron_item_id?: string | null; rack_id?: string | null }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, layer_id: uuid.optional(), x: pos.optional(), y: pos.optional(), kind: fields.kind.optional(), label: fields.label.optional(), notes: fields.notes, device_id: fields.device_id, lutron_item_id: fields.lutron_item_id, rack_id: fields.rack_id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the marker." };
  const { id, ...patch } = parsed.data;
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_markers").update(clean).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this marker.") };
  return { ok: true, message: "Saved." };
}

export async function deleteMarker(input: { id: string }): Promise<ActionResult> {
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Marker not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_markers").delete().eq("id", input.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this marker.") };
  return { ok: true, message: "Marker removed." };
}

const layerFields = {
  name: z.string().trim().min(1, "Name the layer.").max(80),
  kind: z.enum(KINDS).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
};
const layerError = (error: { code?: string } | null, fallback: string) => (error?.code === "23505" ? "This drawing already has a layer with that name." : friendlyDbError(error, fallback));

/** Adds a layer (e.g. "Access points") to a drawing. */
export async function createLayer(input: { id?: string; projectId: string; drawingId: string; name: string; kind?: string | null; color?: string }): Promise<ActionResult & { id?: string }> {
  const parsed = z.object({ id: uuid.optional(), projectId: uuid, drawingId: uuid, ...layerFields }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the layer." };
  const supabase = await createClient();
  const { projectId, drawingId, ...l } = parsed.data;
  const { count } = await supabase.from("drawing_layers").select("id", { count: "exact", head: true }).eq("drawing_id", drawingId);
  const { data, error } = await supabase.from("drawing_layers").insert({ ...l, project_id: projectId, drawing_id: drawingId, sort: count ?? 0 }).select("id").single();
  if (error || !data) return { ok: false, error: layerError(error, "You can't add layers to this drawing.") };
  return { ok: true, message: `Layer “${l.name}” added.`, id: data.id as string };
}

/** Renames a layer or changes its default type / colour. */
export async function updateLayer(input: { id: string; name?: string; kind?: string | null; color?: string }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, name: layerFields.name.optional(), kind: layerFields.kind, color: layerFields.color }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the layer." };
  const { id, ...patch } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_layers").update(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: layerError(error, "You can't change this layer.") };
  return { ok: true, message: "Layer saved." };
}

/** Deletes a layer and everything placed on it. */
export async function deleteLayer(input: { id: string }): Promise<ActionResult> {
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Layer not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_layers").delete().eq("id", input.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this layer.") };
  return { ok: true, message: "Layer deleted." };
}

const point = z.object({ x: pos, y: pos, m: uuid.optional() });
const cableFields = {
  points: z.array(point).min(2, "A cable needs at least two points.").max(400, "That cable has too many points."),
  label: z.string().trim().max(120).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  cable_type: z.string().trim().max(60).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  rack_id: uuid.nullable().optional(),
  notes: fields.notes,
};

/** Draws a cable run (keypad to keypad, speaker to amp, access point to rack…) on a layer. */
export async function addCable(input: { id?: string; projectId: string; drawingId: string; layerId: string; page: number; points: { x: number; y: number; m?: string }[]; label?: string | null; cable_type?: string | null; rack_id?: string | null }): Promise<ActionResult & { id?: string }> {
  const parsed = z.object({ id: uuid.optional(), projectId: uuid, drawingId: uuid, layerId: uuid, page: z.number().int().min(1), ...cableFields }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the cable." };
  const { projectId, drawingId, layerId, ...c } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_cables").insert({ ...c, layer_id: layerId, project_id: projectId, drawing_id: drawingId }).select("id").single();
  if (error || !data) return { ok: false, error: friendlyDbError(error, "You can't mark up this drawing.") };
  return { ok: true, message: "Cable drawn.", id: data.id as string };
}

/** Changes a cable's route, label, type, layer, rack or notes. */
export async function updateCable(input: { id: string; layer_id?: string; points?: { x: number; y: number; m?: string }[]; label?: string | null; cable_type?: string | null; rack_id?: string | null; notes?: string | null }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, layer_id: uuid.optional(), points: cableFields.points.optional(), label: cableFields.label, cable_type: cableFields.cable_type, rack_id: cableFields.rack_id, notes: cableFields.notes }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the cable." };
  const { id, ...patch } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_cables").update(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this cable.") };
  return { ok: true, message: "Saved." };
}

/** Moves a marker and the cables pinned to it in one go. */
export async function moveMarkerWithCables(input: { id: string; x: number; y: number; cables: { id: string; points: { x: number; y: number; m?: string }[] }[] }): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, x: pos, y: pos, cables: z.array(z.object({ id: uuid, points: cableFields.points })).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the marker." };
  const moved = await updateMarker({ id: parsed.data.id, x: parsed.data.x, y: parsed.data.y });
  if (!moved.ok) return moved;
  const supabase = await createClient();
  for (const c of parsed.data.cables) {
    const { error } = await supabase.from("drawing_cables").update({ points: c.points }).eq("id", c.id);
    if (error) return { ok: false, error: friendlyDbError(error, "The marker moved, but a cable couldn't follow it.") };
  }
  return { ok: true, message: "Saved." };
}

export async function deleteCable(input: { id: string }): Promise<ActionResult> {
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Cable not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("drawing_cables").delete().eq("id", input.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't change this cable.") };
  return { ok: true, message: "Cable removed." };
}
