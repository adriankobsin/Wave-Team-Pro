import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { MARKER_KINDS } from "@/lib/site-constants";
import type { StampCable, StampLayer, StampMarker } from "@/lib/drawings/stamp";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Markers of a drawing (optionally only some layers) ready to stamp, each with the details the
 * legend lists: its type and, when linked, the project device (name, make and model, room, IP) or
 * Lutron keypad, plus the marker's own notes.
 */
export async function stampDataFor(supabase: Supabase, drawingId: string, layerIds?: string[]) {
  let lq = supabase.from("drawing_layers").select("id, name, color, sort").eq("drawing_id", drawingId).order("sort").order("name");
  if (layerIds?.length) lq = lq.in("id", layerIds);
  const { data: layers } = await lq;
  const ids = (layers ?? []).map((l) => l.id as string);
  const { data: rows } = ids.length
    ? await supabase.from("drawing_markers").select("page, x, y, kind, label, layer_id, device_id, lutron_item_id, rack_id, notes").eq("drawing_id", drawingId).in("layer_id", ids).limit(10000)
    : { data: [] };
  const markersRaw = rows ?? [];
  const { data: cableRows } = ids.length
    ? await supabase.from("drawing_cables").select("page, points, layer_id, label, cable_type, rack_id, notes").eq("drawing_id", drawingId).in("layer_id", ids).limit(5000)
    : { data: [] };
  const rackIds = [...new Set((cableRows ?? []).map((c) => c.rack_id as string | null).filter((x): x is string => Boolean(x)))];
  const { data: racks } = rackIds.length ? await supabase.from("site_racks").select("id, name").in("id", rackIds) : { data: [] };
  const rackName = new Map((racks ?? []).map((r) => [r.id as string, r.name as string]));
  const devIds = [...new Set(markersRaw.map((m) => m.device_id as string | null).filter((x): x is string => Boolean(x)))];
  const lutIds = [...new Set(markersRaw.map((m) => m.lutron_item_id as string | null).filter((x): x is string => Boolean(x)))];
  const [{ data: devs }, { data: luts }] = await Promise.all([
    devIds.length ? supabase.from("site_devices").select("id, name, manufacturer, model, deck, room, location, ip").in("id", devIds) : Promise.resolve({ data: [] }),
    lutIds.length ? supabase.from("lutron_items").select("id, path, model, component_name, engraving").in("id", lutIds) : Promise.resolve({ data: [] }),
  ]);
  type Dev = { id: string; name: string; manufacturer: string | null; model: string | null; deck: string | null; room: string | null; location: string | null; ip: string | null };
  type Lut = { id: string; path: string; model: string | null; component_name: string | null; engraving: string | null };
  const dev = new Map(((devs ?? []) as Dev[]).map((d) => [d.id, d]));
  const lut = new Map(((luts ?? []) as Lut[]).map((l) => [l.id, l]));
  const layerName = new Map((layers ?? []).map((l) => [l.id as string, l.name as string]));
  const layerColor = new Map((layers ?? []).map((l) => [l.id as string, l.color as string]));

  const markerRacks = [...new Set(markersRaw.map((m) => m.rack_id as string | null).filter((x): x is string => Boolean(x)))];
  const { data: mRacks } = markerRacks.length ? await supabase.from("site_racks").select("id, name, location").in("id", markerRacks) : { data: [] };
  const rackInfo = new Map((mRacks ?? []).map((r) => [r.id as string, { name: r.name as string, location: r.location as string | null }]));
  const markers: StampMarker[] = markersRaw.map((m) => {
    const k = MARKER_KINDS[m.kind as string] ?? MARKER_KINDS.other;
    const label = m.label as string;
    const parts: string[] = [];
    const d = m.device_id ? dev.get(m.device_id as string) : undefined;
    if (d) {
      if (d.name && d.name.trim().toLowerCase() !== label.trim().toLowerCase()) parts.push(d.name);
      const mm = [d.manufacturer, d.model].filter(Boolean).join(" ");
      if (mm) parts.push(mm);
      const where = [d.deck, d.room ?? d.location].filter(Boolean).join(" ");
      if (where) parts.push(where);
      if (d.ip) parts.push(d.ip);
    }
    const l = m.lutron_item_id ? lut.get(m.lutron_item_id as string) : undefined;
    if (l) {
      const name = l.component_name ?? l.path.split("\\").slice(-2).join(" / ");
      if (name && name.trim().toLowerCase() !== label.trim().toLowerCase()) parts.push(name);
      if (l.model) parts.push(`Lutron ${l.model}`);
      if (l.engraving) parts.push(`engraving: ${l.engraving}`);
    }
    const rk = m.rack_id ? rackInfo.get(m.rack_id as string) : undefined;
    if (rk) { if (rk.name.trim().toLowerCase() !== label.trim().toLowerCase()) parts.push(rk.name); if (rk.location) parts.push(rk.location); }
    if (m.notes) parts.push(String(m.notes).replace(/\s+/g, " ").trim());
    return {
      page: m.page as number, x: Number(m.x), y: Number(m.y), short: k.short, label, color: layerColor.get(m.layer_id as string) ?? k.color,
      layer: layerName.get(m.layer_id as string) ?? "", kind: k.label, detail: parts.join(" · ") || undefined, box: k.box,
    };
  });
  const markerLabel = new Map<string, string>();
  if ((cableRows ?? []).length) {
    const { data: all } = await supabase.from("drawing_markers").select("id, label").eq("drawing_id", drawingId).limit(10000);
    for (const m of all ?? []) markerLabel.set(m.id as string, m.label as string);
  }
  const cables: StampCable[] = (cableRows ?? []).map((c) => {
    const points = (c.points as { x: number; y: number; m?: string }[]).map((p) => ({ x: Number(p.x), y: Number(p.y), m: p.m }));
    const route = points.map((p) => (p.m ? markerLabel.get(p.m) : undefined)).filter((x): x is string => Boolean(x));
    const rack = c.rack_id ? rackName.get(c.rack_id as string) : undefined;
    const detail = [c.cable_type, route.length ? route.join(" > ") : null, rack ? `to ${rack}` : null, c.notes ? String(c.notes).replace(/\s+/g, " ").trim() : null].filter(Boolean).join(" · ");
    return {
      page: c.page as number, points: points.map(({ x, y }) => ({ x, y })), color: layerColor.get(c.layer_id as string) ?? "#6b7280",
      layer: layerName.get(c.layer_id as string) ?? "", label: (c.label as string | null) ?? (rack ? `to ${rack}` : undefined), detail: detail || undefined,
    };
  });
  const count = new Map<string, number>();
  for (const m of markersRaw) count.set(m.layer_id as string, (count.get(m.layer_id as string) ?? 0) + 1);
  const stampLayers: StampLayer[] = (layers ?? []).map((l) => ({ name: l.name as string, color: l.color as string, count: count.get(l.id as string) ?? 0 }));
  return { layers: (layers ?? []) as { id: string; name: string; color: string }[], markers, cables, stampLayers };
}
