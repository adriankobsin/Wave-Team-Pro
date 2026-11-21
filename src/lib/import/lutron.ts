import type { PdfItem } from "@/lib/import/pdf-text";

/**
 * Lutron Designer (HomeWorks QSX) reports exported to PDF:
 * - Integration Report: devices with buttons/LEDs, zones, areas, area scenes, shade groups, HVAC zones,
 *   each with its integration address (href, e.g. /device/7384).
 * - Load Schedule: every load (DALI driver, DMX, phase dimming…) by area and zone, with fixture,
 *   load type, the panel/module/loop it is wired to, and wattage.
 */

export type LutronKind = "device" | "button" | "led" | "zone" | "area" | "scene" | "shade_group" | "hvac_zone" | "other";

export type LutronItem = {
  kind: LutronKind;
  path: string; // e.g. TANK DECK\HAIRDRESSER 112\ENTRANCE\Device 1
  href: string; // e.g. /device/7384
  integrationId: number;
  model?: string;
  component?: string; // Button 1, Led 3
  componentName?: string;
  deviceHref?: string; // for buttons and LEDs
};

const HREF = /^\/([a-z]+)\/(\d+)$/;
/** Lutron prints "File Name: … Sheet: n of m" along the foot of every page; drop that band. */
const body = (items: PdfItem[]) => items.filter((i) => i.y > 40);
const lines = (items: PdfItem[]) => {
  // Group items into text lines per page (same y within 2 pt), top to bottom.
  const byPage = new Map<number, PdfItem[]>();
  for (const it of items) byPage.set(it.page, [...(byPage.get(it.page) ?? []), it]);
  const out: { page: number; y: number; items: PdfItem[] }[] = [];
  for (const [page, its] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...its].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const it of sorted) {
      const last = out.at(-1);
      if (last && last.page === page && Math.abs(last.y - it.y) <= 2) last.items.push(it);
      else out.push({ page, y: it.y, items: [it] });
    }
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
};

const SECTION_HEADERS: [RegExp, LutronKind][] = [
  [/^Zone Name$/i, "zone"],
  [/^HVAC Zone Name$/i, "hvac_zone"],
  [/^Area Name$/i, "area"],
  [/^Shade Group Name$/i, "shade_group"],
  [/^Area Scene Name$/i, "scene"],
];

/** Joins wrapped name pieces; prefers the join that matches a known path when given. */
export function joinWrapped(parts: string[], known?: Set<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const spaced = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!known) return spaced;
  if (known.has(spaced)) return spaced;
  // Try joining each break without a space (words split mid-way).
  for (let mask = 1; mask < 1 << (parts.length - 1); mask++) {
    let s = parts[0];
    for (let i = 1; i < parts.length; i++) s += ((mask >> (i - 1)) & 1 ? "" : " ") + parts[i];
    if (known.has(s)) return s;
  }
  return spaced;
}

export function parseIntegrationReport(items: PdfItem[]): LutronItem[] {
  const ls = lines(body(items).filter((i) => i.str !== "Integration Report"));
  const out = new Map<string, LutronItem>();
  let section: LutronKind | "devices" | null = null;
  let device: { href: string; model: string; nameParts: string[]; page: number } | null = null;
  const devices: { href: string; model: string; nameParts: string[] }[] = [];
  let col = { model: 0, href: 0, comp: 0, compHref: 0, compName: 0 };
  let pending: { kind: LutronKind; parts: string[]; href: string } | null = null;

  const flushPending = () => {
    if (pending) {
      const m = HREF.exec(pending.href);
      if (m) out.set(pending.href, { kind: pending.kind, path: joinWrapped(pending.parts), href: pending.href, integrationId: Number(m[2]) });
    }
    pending = null;
  };

  for (const l of ls) {
    const first = l.items[0].str;
    if (first === "Device name") {
      flushPending();
      section = "devices";
      const find = (t: string) => l.items.find((i) => i.str === t)?.x ?? 0;
      col = { model: find("Model"), href: find("href"), comp: find("Component"), compHref: find("Component href"), compName: find("Component Name") };
      continue;
    }
    const header = SECTION_HEADERS.find(([re]) => re.test(first));
    if (header && l.items.length <= 2) {
      flushPending();
      section = header[1];
      device = null;
      continue;
    }
    if (section === "devices") {
      const at = (x0: number, x1: number) => l.items.filter((i) => i.x >= x0 - 3 && i.x < x1 - 3).map((i) => i.str).join(" ");
      const name = at(0, col.model);
      const model = at(col.model, col.href);
      const href = at(col.href, col.comp);
      const comp = at(col.comp, col.compHref);
      const compHref = at(col.compHref, col.compName || 9999);
      const compName = col.compName ? at(col.compName, 9999) : "";
      if (HREF.test(href)) {
        // A device row; repeated on a new page when its components continue there.
        const existing = devices.find((d) => d.href === href);
        if (existing) {
          // The same device continued on a new page: its name is printed again; keep the first one.
          device = { href, model: existing.model, nameParts: ["__continued__"], page: l.page };
        } else {
          device = { href, model, nameParts: name ? [name] : [], page: l.page };
          devices.push({ href, model, nameParts: device.nameParts });
        }
      } else if (name && device && device.nameParts[0] !== "__continued__") {
        device.nameParts.push(name);
      }
      if (device && HREF.test(compHref)) {
        const m = HREF.exec(compHref)!;
        const kind: LutronKind = m[1] === "button" ? "button" : m[1] === "led" ? "led" : "other";
        out.set(compHref, { kind, path: "", href: compHref, integrationId: Number(m[2]), component: comp, componentName: compName || undefined, deviceHref: device.href });
      }
      continue;
    }
    if (section) {
      // Two columns: name, href. A name may wrap onto the next line(s).
      const hrefItem = l.items.find((i) => HREF.test(i.str));
      const nameText = l.items.filter((i) => i !== hrefItem).map((i) => i.str).join(" ");
      if (hrefItem) {
        flushPending();
        pending = { kind: section, parts: nameText ? [nameText] : [], href: hrefItem.str };
      } else if (pending && nameText) {
        pending.parts.push(nameText);
      }
    }
  }
  flushPending();

  // Resolve wrapped names against the area list (fixes words split mid-way), then name devices and components.
  const areaPaths = new Set([...out.values()].filter((i) => i.kind === "area").map((i) => i.path));
  const knownPrefix = (s: string) => [...areaPaths].some((a) => s.startsWith(a + "\\"));
  for (const d of devices) {
    const parts = d.nameParts.filter((p) => p !== "__continued__");
    let path = joinWrapped(parts);
    if (!knownPrefix(path) && parts.length > 1) {
      for (let mask = 1; mask < 1 << (parts.length - 1); mask++) {
        let s = parts[0];
        for (let i = 1; i < parts.length; i++) s += ((mask >> (i - 1)) & 1 ? "" : " ") + parts[i];
        if (knownPrefix(s)) { path = s; break; }
      }
    }
    const m = HREF.exec(d.href)!;
    out.set(d.href, { kind: "device", path, href: d.href, integrationId: Number(m[2]), model: d.model || undefined });
  }
  for (const it of out.values()) {
    if (it.deviceHref) it.path = out.get(it.deviceHref)?.path ?? "";
  }
  return [...out.values()];
}

export type LutronLoad = {
  area: string; // TANK DECK\LOBBY 104
  zoneNumber: number | null;
  zoneName: string;
  zoneDescription: string;
  loadNumber: number | null;
  feed: string;
  fixture: string;
  quantity: number | null;
  loadType: string;
  assignedTo: string; // TANK DECK\LCC 02A\LCC 02A DALI-MODULE\Loop 1
  panel: string; // TANK DECK\LCC 02A
  module: string; // LCC 02A DALI-MODULE
  output: string; // Loop 1
  wattage: number | null;
};

/** Load Schedule: rows per load under an area heading; columns found from each page's header row. */
export function parseLoadSchedule(items: PdfItem[], knownZones?: Set<string>): LutronLoad[] {
  const ls = lines(body(items).filter((i) => i.str !== "Load Schedule"));
  const loads: LutronLoad[] = [];
  let area = "";
  let col: Record<string, number> | null = null;
  let row: Record<string, string[]> | null = null;
  const KEYS = ["zone#", "zoneName", "zoneDesc", "load#", "feed", "fixture", "loadType", "assigned", "watt"] as const;

  const flush = () => {
    if (!row) return;
    const j = (k: string) => (row![k] ?? []).join(" ").replace(/\s+/g, " ").trim();
    const zoneParts = row.zoneName ?? [];
    const zoneName = knownZones ? joinWrapped(zoneParts, new Set([...knownZones].filter((z) => z.startsWith(area + "\\")).map((z) => z.slice(area.length + 1)))) : joinWrapped(zoneParts);
    const fixture = j("fixture");
    const qty = /\((\d+)\)\s*$/.exec(fixture);
    const assigned = j("assigned").replace(/\s*\\\s*/g, "\\");
    const segs = assigned.split("\\").map((x) => x.trim());
    const watt = j("watt").replace(/\s+/g, "");
    loads.push({
      area,
      zoneNumber: Number.parseInt(j("zone#"), 10) || null,
      zoneName,
      zoneDescription: j("zoneDesc"),
      loadNumber: Number.parseInt(j("load#"), 10) || null,
      feed: j("feed"),
      fixture: qty ? fixture.slice(0, qty.index).trim() : fixture,
      quantity: qty ? Number(qty[1]) : null,
      loadType: j("loadType"),
      assignedTo: assigned,
      panel: segs.length >= 2 ? segs.slice(0, 2).join("\\") : assigned,
      module: segs.length >= 3 ? segs.slice(2, -1).join("\\") : "",
      output: segs.length >= 3 ? segs.at(-1)! : "",
      wattage: /^\d+(\.\d+)?$/.test(watt) ? Number(watt) : null,
    });
    row = null;
  };

  for (const l of ls) {
    const texts = l.items.map((i) => i.str);
    if (texts[0] === "Zone #") {
      flush();
      const x = (t: string) => l.items.find((i) => i.str === t)?.x ?? -1;
      col = { "zone#": x("Zone #"), zoneName: x("Zone Name"), zoneDesc: x("Zone"), "load#": x("Load #"), feed: x("Feed"), fixture: x("Fixture (Qty)"), loadType: x("Load Type"), assigned: x("Assigned To"), watt: x("Total") };
      continue;
    }
    if (texts.length === 1 && /\\/.test(texts[0]) && (!col || l.items[0].x < (col.zoneName ?? 60))) {
      // An area heading such as TANK DECK\LOBBY 104 (left aligned, alone on its line).
      if (!row || l.items[0].x < 45) {
        flush();
        area = texts[0];
        continue;
      }
    }
    if (!col) continue;
    if (texts.length === 2 && texts[0] === "Description" && texts[1] === "Wattage") continue;
    const starts = KEYS.map((k) => [k, col![k]] as const).filter(([, v]) => v >= 0).sort((a, b) => a[1] - b[1]);
    const colOf = (x: number) => {
      let k: string = starts[0][0];
      for (const [key, x0] of starts) if (x >= x0 - 4) k = key;
      return k;
    };
    const hasZoneNumber = l.items.some((i) => colOf(i.x) === "zone#" && /^\d+$/.test(i.str));
    if (hasZoneNumber) {
      flush();
      row = {};
    }
    if (!row) continue;
    for (const it of l.items) {
      const k = colOf(it.x);
      (row[k] ??= []).push(it.str);
    }
  }
  flush();
  return loads;
}
