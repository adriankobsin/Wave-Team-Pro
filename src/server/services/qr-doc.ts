import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PdfReport, type RackDrawing } from "@/lib/export/pdf";
import { ITEM_STATUS, TEST_RESULT } from "@/lib/site-constants";
import { getProjectLogo } from "@/server/services/branding";
import { buildProjectPack, type PackSection } from "@/server/services/project-pack";
import { rackCode, rackRoom } from "@/server/services/labels";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));
const like = (v: string) => v.replace(/[%_\\,()]/g, "");

/** What a QR sticker opens: a PDF made on the spot, or (for a drawing) the drawing to mark up and send. */
export type QrDoc = { kind: "pdf"; bytes: Buffer; name: string } | { kind: "drawing"; id: string } | null;

const CABLE_COLS = "label, patch_panel, port, cable_type, system, deck, room, location, device_name, switch_port, test_result, length_m, tested_on, tested_by, tested_by_ids, tested_by_name";
const PORT_COLS = "equipment, port, position, vlan, patch_port, end_location, end_device, poe_w, end_ip";

/** The schedules a project sticker opens: every site schedule and the rack elevations (each drawing has its own sticker). */
const PROJECT_SECTIONS: PackSection[] = ["cables", "devices", "switches", "network", "racks", "lighting", "lutron"];

/**
 * Builds the PDF for a QR target (the path a sticker was printed for, relative to the project).
 * Everything is read with the scanner's own session, so it only contains what they may see.
 */
export async function buildQrDoc(projectId: string, target: string, liveUrl: string, tz: string): Promise<QrDoc> {
  const supabase = await createClient();
  const [path, query = ""] = target.split("?");
  const param = (k: string) => new URLSearchParams(query).get(k);

  const drawing = /^\/drawings\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (drawing) {
    // A sticker printed for an old revision opens the current one.
    let id = drawing;
    for (let i = 0; i < 20; i++) {
      const { data: next } = await supabase.from("project_drawings").select("id").eq("project_id", projectId).eq("supersedes", id).is("archived_at", null).limit(1).maybeSingle();
      if (!next) break;
      id = next.id as string;
    }
    return { kind: "drawing", id };
  }

  const logo = await getProjectLogo(projectId);
  if (path === "") {
    const pack = await buildProjectPack(projectId, new Set(PROJECT_SECTIONS), logo, tz);
    return pack ? { kind: "pdf", bytes: pack.bytes, name: pack.name } : null;
  }

  const { data: project } = await supabase.from("projects").select("name, organizations(name)").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const company = (project.organizations as unknown as { name: string } | null)?.name ?? "";
  const made = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const open = async (title: string, sub: string) => {
    const pdf = await PdfReport.create(`${company} · ${project.name} · ${title} · made ${made}`, logo);
    pdf.title(title, [project.name, sub].filter(Boolean).join(" · "));
    pdf.text(`Made ${made} from the live schedule: ${liveUrl}`);
    return pdf;
  };
  const done = async (pdf: PdfReport, title: string): Promise<QrDoc> => ({ kind: "pdf", bytes: await pdf.bytes(), name: `${project.name} - ${title}.pdf` });

  const names = async (rows: Row[]) => {
    const ids = [...new Set(rows.flatMap((x) => [x.tested_by as string, ...((x.tested_by_ids as string[] | null) ?? [])]).filter(Boolean))];
    const { data } = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
    return new Map((data ?? []).map((x) => [x.id as string, x.display_name as string]));
  };
  const cableTable = (pdf: PdfReport, panel: string, list: Row[], who: Map<string, string>) => {
    const used = list.filter((x) => x.label);
    pdf.heading(panel, `${list.length} ports · ${used.length} cables · ${used.filter((x) => x.test_result === "passed").length} passed`);
    pdf.table(
      [{ label: "Port", width: 7 }, { label: "Cable no.", width: 26 }, { label: "Cable", width: 11 }, { label: "Deck", width: 9 }, { label: "Room / area", width: 22 }, { label: "Location", width: 22 }, { label: "System", width: 11 }, { label: "Device", width: 30 }, { label: "Switch port", width: 20 }, { label: "Length", width: 10, align: "right" }, { label: "Test", width: 16 }, { label: "Tested", width: 26 }],
      list.map((x) => [s(x.port), x.label ? s(x.label) : "(spare)", s(x.cable_type), s(x.deck), s(x.room), s(x.location), s(x.system), s(x.device_name), s(x.switch_port), x.length_m === null ? "" : `${Number(x.length_m)} m`,
        x.label ? TEST_RESULT[x.test_result as string]?.label ?? "" : "", !x.label || x.test_result === "not_tested" ? "" : [(x.tested_by_ids as string[] | null)?.length ? (x.tested_by_ids as string[]).map((u) => who.get(u) ?? "").filter(Boolean).join(", ") : x.tested_by ? who.get(x.tested_by as string) : x.tested_by_name, x.tested_on].filter(Boolean).join(", ")]),
    );
  };
  const portTable = (pdf: PdfReport, eq: string, list: Row[]) => {
    pdf.heading(eq, `${list.length} ports · ${list.filter((x) => x.end_device).length} in use`);
    pdf.table(
      [{ label: "Port", width: 14 }, { label: "VLAN", width: 12 }, { label: "Patch panel port", width: 26 }, { label: "Location", width: 24 }, { label: "End device", width: 44 }, { label: "PoE (W)", width: 10, align: "right" }, { label: "End device IP", width: 18 }],
      list.map((x) => [s(x.port), s(x.vlan), s(x.patch_port), s(x.end_location), s(x.end_device), num(x.poe_w), s(x.end_ip)]),
    );
  };
  const byPort = (a: Row, b: Row) => s(a.port).localeCompare(s(b.port), undefined, { numeric: true });

  if (path === "/site/cables" && param("panel")) {
    const panel = param("panel")!;
    const { data } = await supabase.from("site_cables").select(CABLE_COLS).eq("project_id", projectId).eq("patch_panel", panel).is("archived_at", null).limit(2000);
    const rows = ((data ?? []) as Row[]).sort(byPort);
    if (!rows.length) return null;
    const pdf = await open(`Patch panel ${panel}`, "Cable schedule");
    cableTable(pdf, panel, rows, await names(rows));
    return done(pdf, `Patch panel ${panel}`);
  }

  if (path === "/site/switches" && param("eq")) {
    const eq = param("eq")!;
    const [{ data: info }, { data }] = await Promise.all([
      supabase.from("site_equipment").select("title, model, location").eq("project_id", projectId).eq("sheet", eq).is("archived_at", null).maybeSingle(),
      supabase.from("site_ports").select(PORT_COLS).eq("project_id", projectId).eq("equipment", eq).is("archived_at", null).order("position").limit(2000),
    ]);
    if (!info && !(data ?? []).length) return null;
    const pdf = await open(eq, ["Switch port schedule", info?.title, info?.model, info?.location].filter(Boolean).join(" · "));
    portTable(pdf, eq, (data ?? []) as Row[]);
    return done(pdf, `Switch ${eq}`);
  }

  if (path === "/site/lighting" && param("panel")) {
    const panel = param("panel")!;
    const { data } = await supabase.from("lighting_loads").select("area, zone_number, zone_name, zone_href, load_number, fixture, quantity, load_type, module, output, wattage, dali_address, status")
      .eq("project_id", projectId).eq("panel", panel).is("archived_at", null).order("module").order("output").limit(5000);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return null;
    const short = panel.split("\\").pop() ?? panel;
    const pdf = await open(`Lighting panel ${short}`, `${panel.replace(/\\/g, " / ")} · ${rows.length} loads · ${new Set(rows.map((x) => x.module)).size} modules`);
    for (const mod of [...new Set(rows.map((x) => s(x.module)))]) {
      const list = rows.filter((x) => s(x.module) === mod).sort((a, b) => s(a.output).localeCompare(s(b.output), undefined, { numeric: true }));
      pdf.heading(mod || "No module", `${list.length} loads`);
      pdf.table(
        [{ label: "Output", width: 10 }, { label: "Area", width: 30 }, { label: "Zone", width: 30 }, { label: "Zone ID", width: 12 }, { label: "Load", width: 6 }, { label: "Fixture", width: 18 }, { label: "Qty", width: 5, align: "right" }, { label: "Load type", width: 18 }, { label: "W", width: 7, align: "right" }, { label: "DALI", width: 8 }, { label: "Status", width: 13 }],
        list.map((x) => [s(x.output), s(x.area), `${s(x.zone_number)}. ${s(x.zone_name)}`, s(x.zone_href).replace(/\D/g, ""), s(x.load_number), s(x.fixture), s(x.quantity), s(x.load_type), num(x.wattage), s(x.dali_address), ITEM_STATUS[x.status as string]?.label ?? ""]),
      );
    }
    return done(pdf, `Lighting panel ${short}`);
  }

  const rackId = /^\/site\/racks\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (rackId) {
    const { data: rack } = await supabase.from("site_racks").select("id, name, units, location").eq("id", rackId).eq("project_id", projectId).maybeSingle();
    if (!rack) return null;
    const code = rackCode(rack.name as string), room = rackRoom(rack.name as string);
    const [{ data: items }, { data: cables }, { data: switches }] = await Promise.all([
      supabase.from("site_rack_items").select("u_bottom, u_size, kind, label").eq("rack_id", rackId).order("u_bottom", { ascending: false }).limit(500),
      supabase.from("site_cables").select(CABLE_COLS).eq("project_id", projectId).is("archived_at", null).ilike("patch_panel", `%${like(code)}%`).limit(5000),
      room ? supabase.from("site_equipment").select("sheet").eq("project_id", projectId).is("archived_at", null).or(`sheet.ilike.%${like(room)}%,location.ilike.%${like(room)}%`).order("sheet") : Promise.resolve({ data: [] as { sheet: string }[] }),
    ]);
    const sheets = (switches ?? []).map((x) => x.sheet as string);
    const { data: ports } = sheets.length ? await supabase.from("site_ports").select(PORT_COLS).eq("project_id", projectId).in("equipment", sheets).is("archived_at", null).order("position").limit(5000) : { data: [] };
    const cableRows = (cables ?? []) as Row[];
    const panels = [...new Set(cableRows.map((x) => x.patch_panel as string))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const pdf = await open(rack.name as string, [`${rack.units}U rack`, rack.location, panels.length ? `${panels.length} patch panel${panels.length === 1 ? "" : "s"}` : null, sheets.length ? `${sheets.length} switch${sheets.length === 1 ? "" : "es"} in the room` : null].filter(Boolean).join(" · "));

    pdf.heading("What is in the rack", `${(items ?? []).length} items`);
    pdf.table(
      [{ label: "U", width: 10 }, { label: "Height", width: 10 }, { label: "Type", width: 20 }, { label: "Item", width: 90 }],
      (items ?? []).map((i) => [i.u_size > 1 ? `U${i.u_bottom + i.u_size - 1}-U${i.u_bottom}` : `U${i.u_bottom}`, `${i.u_size}U`, s(i.kind).replace(/_/g, " "), s(i.label)]),
    );
    const who = await names(cableRows);
    for (const p of panels) cableTable(pdf, p, cableRows.filter((x) => x.patch_panel === p).sort(byPort), who);
    for (const sh of sheets) { const list = ((ports ?? []) as Row[]).filter((x) => x.equipment === sh); if (list.length) portTable(pdf, sh, list); }
    pdf.racks([{ name: rack.name as string, units: rack.units as number, items: (items ?? []) as unknown as RackDrawing["items"] }]);
    return done(pdf, `Rack ${code}`);
  }

  return null;
}
