import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PdfReport, type RackDrawing } from "@/lib/export/pdf";
import { stampDrawing } from "@/lib/drawings/stamp";
import { stampDataFor } from "@/server/services/drawing-stamp-data";
import { DECKS, DISCIPLINES, ITEM_STATUS, TEST_RESULT } from "@/lib/site-constants";
import { logServerError } from "@/lib/errors";
import { loadProjectReport, writeProjectReport } from "@/server/services/project-report";
import type { Logo } from "@/server/services/branding";

/** What can go into the project pack, in the order it appears. */
export const PACK_SECTIONS = [
  ["summary", "Project summary, tasks and project log"],
  ["money", "Hours and expenses (internal)"],
  ["cables", "Cable & patch panel schedule"],
  ["devices", "Device list"],
  ["switches", "Switch port schedule"],
  ["network", "VLANs and IP addresses"],
  ["racks", "Rack elevations"],
  ["lighting", "Lighting load schedule"],
  ["lutron", "Lutron integration IDs"],
  ["drawings", "Drawings, with their layers marked"],
] as const;
export type PackSection = (typeof PACK_SECTIONS)[number][0];

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const deck = (v: unknown) => (v ? `${v}` : "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));
const ipKey = (ip: string) => ip.split(".").map((p) => p.padStart(3, "0")).join(".");

async function all(table: string, cols: string, projectId: string, order: string[], liveOnly = false) {
  const supabase = await createClient();
  const out: Row[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    let q = supabase.from(table).select(cols).eq("project_id", projectId);
    if (liveOnly) q = q.is("archived_at", null);
    for (const o of order) q = q.order(o);
    const { data } = await q.range(from, from + 999);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const live = true;

/**
 * One branded PDF with everything about a project: cover with the company logo, contents, the
 * project report, every site schedule, rack elevations and each current drawing with its layers.
 * Read with the requester's own session, so it only ever contains what they can see.
 */
export async function buildProjectPack(projectId: string, sections: Set<PackSection>, logo: Logo | null, tz: string) {
  const r = await loadProjectReport(projectId, tz);
  if (!r) return null;
  const p = r.project;
  const pdf = await PdfReport.create(`${p.company} · ${p.name} · Project pack · ${r.generated.slice(0, 10)}`, logo, { numbersAtEnd: true, noFirstPage: true });
  pdf.cover({
    company: p.company, kind: "Project pack", title: p.name, subtitle: [p.code, p.site, p.country].filter(Boolean).join(" · "),
    details: [["Company", p.company], ["Project manager", p.manager], ["Status", p.status], ["Dates", [p.start, p.end].filter(Boolean).join(" to ")], ["Project code", p.code], ["Location", [p.site, p.country].filter(Boolean).join(", ")]],
    generated: r.generated,
  });
  const contentsPage = pdf.reserveContents();
  const contents: { title: string; page: number; sub?: boolean }[] = [];
  const start = (title: string, sub?: string) => { const n = pdf.pageBreak(); pdf.title(title, sub); contents.push({ title, page: n }); };

  if (sections.has("summary") || sections.has("money")) {
    start("Project report", [p.company, p.code, p.site, p.status].filter(Boolean).join(" · "));
    writeProjectReport(pdf, r, { tasks: sections.has("summary"), log: sections.has("summary"), money: sections.has("money") });
  }

  if (sections.has("cables")) {
    const rows = await all("site_cables", "label, rack, patch_panel, port, cable_type, system, deck, room, location, device_name, switch_port, test_result, length_m, tested_on, tested_by, tested_by_ids, tested_by_name", projectId, ["patch_panel", "port"], live);
    const ids = [...new Set(rows.flatMap((x) => [x.tested_by as string, ...((x.tested_by_ids as string[] | null) ?? [])]).filter(Boolean))];
    const supabase = await createClient();
    const { data: ppl } = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
    const who = new Map((ppl ?? []).map((x) => [x.id as string, x.display_name as string]));
    const used = rows.filter((x) => x.label);
    const passed = used.filter((x) => x.test_result === "passed").length;
    start("Cable & patch panel schedule", `${used.length} cables on ${new Set(rows.map((x) => x.patch_panel)).size} patch panels · ${passed} passed · ${rows.length - used.length} spare ports`);
    for (const panel of [...new Set(used.map((x) => x.patch_panel as string))]) {
      const list = used.filter((x) => x.patch_panel === panel);
      pdf.heading(panel, `${list.length} cables · ${list.filter((x) => x.test_result === "passed").length} passed`);
      pdf.table(
        [{ label: "Deck", width: 9 }, { label: "Room / area", width: 22 }, { label: "Cable", width: 11 }, { label: "Port", width: 7 }, { label: "Cable no.", width: 26 }, { label: "Location", width: 24 }, { label: "System", width: 11 }, { label: "Device", width: 30 }, { label: "Switch port", width: 20 }, { label: "Length", width: 10, align: "right" }, { label: "Test", width: 16 }, { label: "Tested", width: 26 }],
        list.map((x) => [deck(x.deck), s(x.room), s(x.cable_type), s(x.port), s(x.label), s(x.location), s(x.system), s(x.device_name), s(x.switch_port), x.length_m === null ? "" : `${Number(x.length_m)} m`,
          TEST_RESULT[x.test_result as string]?.label ?? "", x.test_result === "not_tested" ? "" : [(x.tested_by_ids as string[] | null)?.length ? (x.tested_by_ids as string[]).map((u) => who.get(u) ?? "").filter(Boolean).join(", ") : x.tested_by ? who.get(x.tested_by as string) : x.tested_by_name, x.tested_on].filter(Boolean).join(", ")]),
      );
    }
  }

  if (sections.has("devices")) {
    const rows = await all("site_devices", "deck, room, location, system, type, name, manufacturer, model, ip, mac, serial, poe_w, patch_panel, patch_port, switch_port, status", projectId, ["deck", "room", "name"], live);
    start("Device list", `${rows.length} devices · ${Object.entries(DECKS).map(([k, v]) => [v, rows.filter((x) => x.deck === k).length] as const).filter(([, n]) => n).map(([v, n]) => `${v} ${n}`).join(" · ")}`);
    pdf.table(
      [{ label: "Deck", width: 8 }, { label: "Room / area", width: 20 }, { label: "Device", width: 34 }, { label: "Manufacturer", width: 16 }, { label: "Model", width: 20 }, { label: "Type", width: 16 }, { label: "System", width: 10 }, { label: "IP", width: 16 }, { label: "MAC", width: 21 }, { label: "Serial", width: 16 }, { label: "Patch / switch", width: 22 }, { label: "Status", width: 13 }],
      rows.map((x) => [deck(x.deck), [x.room, x.location].filter(Boolean).join(" · "), s(x.name), s(x.manufacturer), s(x.model), s(x.type), s(x.system), s(x.ip), s(x.mac), s(x.serial), x.patch_panel ? `${x.patch_panel} · ${x.patch_port}` : s(x.switch_port), ITEM_STATUS[x.status as string]?.label ?? ""]),
    );
  }

  if (sections.has("switches")) {
    const rows = await all("site_ports", "equipment, port, position, vlan, patch_port, end_location, end_device, poe_w, end_ip", projectId, ["equipment", "position"], live);
    start("Switch port schedule", `${new Set(rows.map((x) => x.equipment)).size} switches · ${rows.length} ports`);
    for (const eq of [...new Set(rows.map((x) => x.equipment as string))]) {
      const list = rows.filter((x) => x.equipment === eq);
      pdf.heading(eq, `${list.length} ports · ${list.filter((x) => x.end_device).length} in use`);
      pdf.table(
        [{ label: "Port", width: 14 }, { label: "VLAN", width: 12 }, { label: "Patch panel port", width: 26 }, { label: "Location", width: 24 }, { label: "End device", width: 44 }, { label: "PoE (W)", width: 10, align: "right" }, { label: "End device IP", width: 18 }],
        list.map((x) => [s(x.port), s(x.vlan), s(x.patch_port), s(x.end_location), s(x.end_device), num(x.poe_w), s(x.end_ip)]),
      );
    }
  }

  if (sections.has("network")) {
    const vlans = await all("site_vlans", "vlan_id, name, ip_range, subnet_mask, gateway, dns, dhcp_scope", projectId, ["vlan_id"], live);
    const ips = (await all("site_ips", "vlan_id, address, device_name", projectId, ["address"], live)).sort((a, b) => ipKey(s(a.address)).localeCompare(ipKey(s(b.address))));
    start("VLANs and IP addresses", `${vlans.length} VLANs · ${ips.length} addresses`);
    pdf.heading("VLANs");
    pdf.table(
      [{ label: "VLAN", width: 8 }, { label: "Name", width: 26 }, { label: "IP range", width: 24 }, { label: "Subnet mask", width: 18 }, { label: "Gateway", width: 16 }, { label: "DNS", width: 22 }, { label: "DHCP scope", width: 26 }],
      vlans.map((x) => [s(x.vlan_id), s(x.name), s(x.ip_range), s(x.subnet_mask), s(x.gateway), s(x.dns), s(x.dhcp_scope)]),
    );
    pdf.heading("IP addresses");
    // Two address lists side by side to keep the section short.
    const half = Math.ceil(ips.length / 2);
    pdf.table(
      [{ label: "Address", width: 14 }, { label: "VLAN", width: 6 }, { label: "Device", width: 40 }, { label: "Address", width: 14 }, { label: "VLAN", width: 6 }, { label: "Device", width: 40 }],
      ips.slice(0, half).map((a, i) => { const b = ips[half + i]; return [s(a.address), s(a.vlan_id), s(a.device_name), b ? s(b.address) : "", b ? s(b.vlan_id) : "", b ? s(b.device_name) : ""]; }),
    );
  }

  if (sections.has("racks")) {
    const racks = await all("site_racks", "id, name, units", projectId, ["name"], live);
    const items = await all("site_rack_items", "rack_id, u_bottom, u_size, kind, label", projectId, ["u_bottom"]);
    start("Rack elevations", `${racks.length} racks`);
    pdf.racks(racks.map((x) => ({ name: s(x.name), units: x.units as number, items: items.filter((i) => i.rack_id === x.id) as unknown as RackDrawing["items"] })));
  }

  if (sections.has("lighting")) {
    const rows = await all("lighting_loads", "area, zone_number, zone_name, zone_href, load_number, fixture, quantity, load_type, panel, module, output, wattage, dali_address, status", projectId, ["area", "zone_number", "load_number"], live);
    start("Lighting load schedule", `${rows.length} loads in ${new Set(rows.map((x) => x.area)).size} areas`);
    for (const area of [...new Set(rows.map((x) => x.area as string))]) {
      const list = rows.filter((x) => x.area === area);
      pdf.heading(area, `${list.length} loads`);
      pdf.table(
        [{ label: "Zone", width: 30 }, { label: "Zone ID", width: 12 }, { label: "Load", width: 6 }, { label: "Fixture", width: 18 }, { label: "Qty", width: 5, align: "right" }, { label: "Load type", width: 18 }, { label: "Panel", width: 22 }, { label: "Module", width: 24 }, { label: "Output", width: 10 }, { label: "W", width: 7, align: "right" }, { label: "DALI", width: 8 }, { label: "Status", width: 13 }],
        list.map((x) => [`${s(x.zone_number)}. ${s(x.zone_name)}`, s(x.zone_href).replace(/\D/g, ""), s(x.load_number), s(x.fixture), s(x.quantity), s(x.load_type), s(x.panel), s(x.module), s(x.output), num(x.wattage), s(x.dali_address), ITEM_STATUS[x.status as string]?.label ?? ""]),
      );
    }
  }

  if (sections.has("lutron")) {
    const rows = await all("lutron_items", "kind, path, href, integration_id, model, component, component_name, device_href, engraving", projectId, ["path", "integration_id"]);
    const devices = rows.filter((x) => x.kind === "device");
    const n = (v: unknown) => Number.parseInt(s(v).replace(/\D/g, ""), 10) || 0;
    start("Lutron integration IDs", `${devices.length} keypads and devices · ${rows.filter((x) => x.kind === "zone").length} zones · ${rows.filter((x) => x.kind === "scene").length} scenes`);
    pdf.heading("Keypads and buttons");
    const kp: string[][] = [];
    for (const d of devices) {
      kp.push([s(d.path), s(d.model), "Device", s(d.integration_id), ""]);
      for (const c of rows.filter((x) => x.device_href === d.href).sort((a, b) => (a.kind === b.kind ? n(a.component) - n(b.component) : a.kind === "button" ? -1 : 1))) {
        kp.push(["", "", s(c.component), s(c.integration_id), s(c.engraving ?? c.component_name)]);
      }
    }
    pdf.table([{ label: "Keypad / device", width: 70 }, { label: "Model", width: 22 }, { label: "Component", width: 16 }, { label: "Integration ID", width: 14 }, { label: "Engraving / name", width: 34 }], kp);
    for (const [k, label] of [["zone", "Zones"], ["area", "Areas"], ["scene", "Area scenes"], ["shade_group", "Shade groups"], ["hvac_zone", "HVAC zones"]] as const) {
      const list = rows.filter((x) => x.kind === k);
      if (!list.length) continue;
      pdf.heading(label, `${list.length}`);
      pdf.table([{ label: "Name", width: 90 }, { label: "Integration ID", width: 16 }, { label: "Address", width: 20 }], list.map((x) => [s(x.path), s(x.integration_id), s(x.href)]));
    }
  }

  if (sections.has("drawings")) {
    const supabase = await createClient();
    const { data: drawings } = await supabase.from("project_drawings").select("id, discipline, number, title, revision, storage_path")
      .eq("project_id", projectId).is("archived_at", null).is("superseded_at", null).order("discipline").order("title");
    const label = new Map(DISCIPLINES);
    if (!drawings?.length) { start("Drawings"); pdf.text("No drawings have been uploaded."); }
    else contents.push({ title: "Drawings", page: pdf.pageCount + 1 });
    const admin = createAdminClient();
    for (const d of drawings ?? []) {
      const name = [d.number, d.title, d.revision ? `rev ${d.revision}` : null].filter(Boolean).join(" ");
      try {
        const [{ data: file, error }, { markers, cables, stampLayers }] = await Promise.all([
          admin.storage.from("files").download(d.storage_path as string),
          stampDataFor(supabase, d.id as string),
        ]);
        if (error || !file) throw error ?? new Error("missing file");
        let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
        if (markers.length || cables.length) bytes = await stampDrawing(bytes, markers, stampLayers.filter((l) => l.count), `${p.name} · ${name}`, { cables, logo });
        const first = await pdf.appendPdf(bytes);
        contents.push({ title: `${name} (${label.get(d.discipline as string) ?? d.discipline})${markers.length ? ` · ${stampLayers.filter((l) => l.count).map((l) => l.name).join(", ")}` : ""}`, page: first, sub: true });
      } catch (e) {
        logServerError("project.pack.drawing", e);
        const n2 = pdf.pageBreak();
        pdf.title(name, "This drawing couldn't be added to the pack. Download it from the Drawings page.");
        contents.push({ title: `${name} (not included)`, page: n2, sub: true });
      }
    }
  }

  pdf.fillContents(contentsPage, contents);
  return { bytes: await pdf.bytes(), name: `${(p.code || p.name).replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40)}-project-pack-${r.generated.slice(0, 10)}.pdf` };
}
