import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { safeText } from "@/lib/export/cells";
import { BRAND } from "@/lib/brand";
import { addLogo } from "@/lib/export/excel-logo";
import { getProjectLogo, type Logo } from "@/server/services/branding";
import { TEST_RESULT, ITEM_STATUS } from "@/server/services/site";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

async function all(table: string, cols: string, projectId: string, order: string[]) {
  const supabase = await createClient();
  const out: Row[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    let q = supabase.from(table).select(cols).eq("project_id", projectId).is("archived_at", null);
    for (const o of order) q = q.order(o);
    const { data } = await q.range(from, from + 999);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Every sheet starts with a heading ("Company · Project — Schedule") and the project company's logo on the right. */
type Heading = { text: string; logo: Logo | null };

function makeSheet(heading: Heading, wb: ExcelJS.Workbook, name: string, headers: [string, number][], rows: unknown[][]) {
  const ws = wb.addWorksheet(name);
  const top = ws.addRow([safeText(`${heading.text} — ${name}`)]);
  top.font = { bold: true, size: 13 };
  top.alignment = { vertical: "middle" };
  ws.addRow(headers.map(([h]) => h)).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((v) => (typeof v === "string" ? safeText(v) : v ?? "")));
  headers.forEach(([, w], i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };
  addLogo(wb, ws, heading.logo, Math.max(3, headers.length - 3));
  if (heading.logo) ws.getRow(1).height = 36;
  return ws;
}

/** Excel exports of the site schedules (project managers and super admins). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const ctx = await getOrgContext(org);
  const supabase = await createClient();
  const [{ data: project }, { data: canEdit }] = await Promise.all([
    supabase.from("projects").select("id, name, organization_id").eq("id", id).maybeSingle(),
    supabase.rpc("can_edit_project", { p_project: id }),
  ]);
  if (!project || project.organization_id !== ctx.org.id) return new NextResponse("Not found", { status: 404 });
  if (!canEdit) return new NextResponse("Only project managers and super admins can export.", { status: 403 });
  const kind = req.nextUrl.searchParams.get("kind") ?? "cables";
  const heading: Heading = { text: `${ctx.org.name} · ${project.name}`, logo: await getProjectLogo(id) };
  const sheet = (w: ExcelJS.Workbook, name: string, headers: [string, number][], rows: unknown[][]) => makeSheet(heading, w, name, headers, rows);
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  let title = "Export";

  if (kind === "cables") {
    title = "Cable schedule";
    const rows = await all("site_cables", "label, rack, patch_panel, port, cable_type, system, deck, room, location, device_name, switch_port, installed, test_result, length_m, tested_on, tested_by, tested_by_ids, tested_by_name, notes", id, ["patch_panel", "port"]);
    const ids = [...new Set(rows.flatMap((r) => [r.tested_by as string, ...((r.tested_by_ids as string[] | null) ?? [])]).filter(Boolean))];
    const { data: ppl } = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
    const who = new Map((ppl ?? []).map((p) => [p.id as string, p.display_name as string]));
    sheet(wb, "Cables", [["Rack", 8], ["Patch Panel", 18], ["Port", 6], ["Cable No.", 34], ["Type", 9], ["System", 8], ["Deck", 6], ["Room", 8], ["Location", 22], ["Device", 30], ["Switch port", 18], ["Installed", 9], ["Test result", 14], ["Length (m)", 10], ["Tested on", 11], ["Tested by", 22], ["Notes", 40]],
      rows.map((r) => [r.rack, r.patch_panel, r.port, r.label, r.cable_type, r.system, r.deck, r.room, r.location, r.device_name, r.switch_port, r.installed ? "Yes" : "", TEST_RESULT[r.test_result as string]?.label, r.length_m === null ? null : Number(r.length_m), r.tested_on, (r.tested_by_ids as string[] | null)?.length ? (r.tested_by_ids as string[]).map((u) => who.get(u) ?? "").filter(Boolean).join(", ") : r.tested_by ? who.get(r.tested_by as string) : r.tested_by_name, r.notes]));
  } else if (kind === "devices") {
    title = "Device list";
    const rows = await all("site_devices", "deck, room, location, system, type, name, model, hostname, port, poe_w, mac, serial, ip, firmware, switch_port, cable_label, patch_panel, patch_port, status, notes", id, ["deck", "room", "name"]);
    sheet(wb, "Devices", [["Floor", 6], ["Room", 8], ["Location", 22], ["System", 8], ["Type", 16], ["End Device", 32], ["Model", 18], ["Hostname", 20], ["Port", 8], ["PoE (W)", 8], ["MAC", 19], ["Serial #", 16], ["IP", 15], ["Firmware", 10], ["Switch port", 18], ["Cable No", 34], ["Patch Panel", 16], ["Port", 6], ["Status", 13], ["Notes", 30]],
      rows.map((r) => [r.deck, r.room, r.location, r.system, r.type, r.name, r.model, r.hostname, r.port, r.poe_w === null ? null : Number(r.poe_w), r.mac, r.serial, r.ip, r.firmware, r.switch_port, r.cable_label, r.patch_panel, r.patch_port, ITEM_STATUS[r.status as string]?.label, r.notes]));
  } else if (kind === "ports") {
    title = "Switch ports";
    const rows = await all("site_ports", "equipment, port, position, vlan, patch_port, end_location, end_device, poe_w, end_ip, notes", id, ["equipment", "position"]);
    sheet(wb, "Ports", [["Equipment", 18], ["Port", 12], ["VLAN", 10], ["Patch Panel Port", 18], ["End Device Location", 18], ["End Device", 34], ["PoE (W)", 8], ["End Device IP", 15], ["Notes", 30]],
      rows.map((r) => [r.equipment, r.port, r.vlan, r.patch_port, r.end_location, r.end_device, r.poe_w === null ? null : Number(r.poe_w), r.end_ip, r.notes]));
  } else if (kind === "integration") {
    title = "Lutron integration schedule";
    const rows = await all("lutron_items", "kind, path, href, integration_id, model, component, component_name, device_href, engraving, notes", id, ["path", "integration_id"]);
    const devices = rows.filter((r) => r.kind === "device");
    const parts = rows.filter((r) => r.device_href);
    const n = (s: unknown) => Number.parseInt(String(s ?? "").replace(/\D/g, ""), 10) || 0;
    const kp: unknown[][] = [];
    for (const d of devices) {
      kp.push([d.path, d.model, "Device", d.integration_id, d.href, "", ""]);
      for (const c of parts.filter((p) => p.device_href === d.href).sort((a, b) => (a.kind === b.kind ? n(a.component) - n(b.component) : a.kind === "button" ? -1 : 1))) {
        kp.push([d.path, d.model, c.component, c.integration_id, c.href, c.engraving ?? c.component_name ?? "", c.notes ?? ""]);
      }
    }
    sheet(wb, "Keypads", [["Keypad", 52], ["Model", 18], ["Component", 12], ["Integration ID", 14], ["Address", 16], ["Engraving / name", 26], ["Notes", 30]], kp);
    for (const [k, label] of [["zone", "Zones"], ["area", "Areas"], ["scene", "Area scenes"], ["shade_group", "Shade groups"], ["hvac_zone", "HVAC zones"]] as const) {
      const list = rows.filter((r) => r.kind === k);
      if (list.length) sheet(wb, label, [["Name", 60], ["Integration ID", 14], ["Address", 18]], list.map((r) => [r.path, r.integration_id, r.href]));
    }
  } else if (kind === "loads") {
    title = "Lighting load schedule";
    const rows = await all("lighting_loads", "area, zone_number, zone_name, load_number, fixture, quantity, load_type, panel, module, output, wattage, zone_href, dali_address, driver, status, notes", id, ["area", "zone_number", "load_number"]);
    sheet(wb, "Loads", [["Area", 34], ["Zone #", 7], ["Zone", 28], ["Zone ID", 14], ["Load #", 7], ["Fixture", 16], ["Qty", 5], ["Load type", 18], ["Panel", 22], ["Module", 24], ["Loop / output", 12], ["W", 6], ["DALI address", 11], ["Driver", 20], ["Status", 13], ["Notes", 30]],
      rows.map((r) => [r.area, r.zone_number, r.zone_name, r.zone_href, r.load_number, r.fixture, r.quantity, r.load_type, r.panel, r.module, r.output, r.wattage === null ? null : Number(r.wattage), r.dali_address, r.driver, ITEM_STATUS[r.status as string]?.label, r.notes]));
  } else {
    return new NextResponse("Unknown export", { status: 400 });
  }
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const file = `${project.name} - ${title}.xlsx`.replace(/[^A-Za-z0-9 ._-]+/g, "");
  return new NextResponse(new Uint8Array(buf), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${file}"`, "cache-control": "private, no-store" },
  });
}
