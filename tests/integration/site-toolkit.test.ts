import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;
let project: string;
let cable: string;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee", carol: "employee" });
  [{ id: project }] = (await db.query("insert into public.projects (organization_id, name, created_by) values ($1, 'MY Seabreeze', $2) returning id", [f.orgA, f.u.admin])).rows;
  await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [project, f.orgA, f.m.bob]);
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;

describe("site toolkit", () => {
  it("the project manager imports; the company is taken from the project", async () => {
    const [d] = await q("admin", "insert into public.site_devices (project_id, import_key, name, patch_panel, patch_port) values ($1, 'TSW-501#1', 'Crestron TSW - 501', 'MEC552-R2-PP1', 5) returning id, organization_id", [project]);
    expect(d.organization_id).toBe(f.orgA);
    [{ id: cable }] = await q("admin", "insert into public.site_cables (project_id, label, patch_panel, port, cable_type) values ($1, 'AV-MEC552-R2-PP1-P5-BD501-TP1', 'MEC552-R2-PP1', 5, 'CAT6A') returning id", [project]);
    await q("admin", "insert into public.lutron_items (project_id, kind, path, href, integration_id) values ($1, 'zone', 'TANK DECK\\LOBBY 104\\HALL DOWNLIGHTS', '/zone/5608', 5608)", [project]);
    await q("admin", "insert into public.lighting_loads (project_id, area, zone_name, load_number, load_type) values ($1, 'TANK DECK\\LOBBY 104', 'HALL DOWNLIGHTS', 1, 'LED DALI')", [project]);
    const [{ link_site_records: linked }] = await q("admin", "select public.link_site_records($1)", [project]);
    expect(linked).toEqual({ cables: 1, loads: 1 });
    await expect(q("bob", "insert into public.site_cables (project_id, patch_panel, port) values ($1, 'X', 1)", [project])).rejects.toThrow(/row-level security/);
    await expect(q("bob", "select public.link_site_records($1)", [project])).rejects.toThrow(/project manager/);
  });

  it("the project team records tests; every change is kept with who made it", async () => {
    await q("bob", "update public.site_cables set test_result = 'passed', length_m = 27.4, tested_on = current_date, tested_by = $2 where id = $1", [cable, f.u.bob]);
    const [h] = await q("bob", "select changes, changed_by from public.site_changes where row_id = $1 order by id desc limit 1", [cable]);
    expect(h.changed_by).toBe(f.u.bob);
    expect(h.changes.test_result).toEqual(["not_tested", "passed"]);
    expect(Number(h.changes.length_m[1])).toBe(27.4);
  });

  it("colleagues outside the project and other companies see nothing", async () => {
    expect(await q("carol", "select id from public.site_cables where project_id = $1", [project])).toHaveLength(0);
    expect(await q("outsider", "select id from public.lighting_loads where project_id = $1", [project])).toHaveLength(0);
    const none = await as(db, f.claims("carol"), (c) => c("update public.site_cables set test_result = 'failed' where id = $1", [cable]));
    expect(none.rowCount).toBe(0);
  });

  it("rows can't be moved to another project", async () => {
    const [{ id: other }] = (await db.query("insert into public.projects (organization_id, name, created_by) values ($1, 'Other', $2) returning id", [f.orgA, f.u.admin])).rows;
    await expect(q("admin", "update public.site_cables set project_id = $2 where id = $1", [cable, other])).rejects.toThrow(/another project/);
  });

  it("the team adds devices by hand; only the project manager removes them", async () => {
    const [d] = await q("bob", "insert into public.site_devices (project_id, import_key, name, manufacturer, type) values ($1, 'manual:1', 'Owner cabin keypad', 'Lutron', 'Keypad') returning id", [project]);
    await q("bob", "update public.site_devices set room = 'OD-401' where id = $1", [d.id]);
    await expect(q("bob", "update public.site_devices set archived_at = now() where id = $1", [d.id])).rejects.toThrow(/project manager/);
    await q("admin", "update public.site_devices set archived_at = now() where id = $1", [d.id]);
  });

  it("rack items fit the rack and never overlap; the imported rack sheet becomes a layout", async () => {
    await db.query("insert into public.site_rack_units (project_id, rack, unit, item) select $1, '552-R1', u, i from (values (1,'APC UPS'),(2,'APC UPS'),(3,'APC UPS'),(4,'BLANK'),(5,'QSYS CQ-X 4K8'),(6,'QSYS CQ-X 4K8'),(7,'BRUSH PLATE'),(8,'24P CAT6A PATCH PANEL'),(42,'PDU')) v(u, i)", [project]);
    const [{ seed_rack_layout: n }] = await q("admin", "select public.seed_rack_layout($1)", [project]);
    expect(n).toBe(1);
    const items = await q("admin", "select label, kind, u_bottom, u_size, manufacturer from public.site_rack_items i join public.site_racks r on r.id = i.rack_id where r.project_id = $1 order by u_bottom", [project]);
    expect(items.map((i) => [i.kind, i.u_bottom, i.u_size])).toEqual([["ups", 1, 3], ["equipment", 5, 2], ["brush", 7, 1], ["patch_panel", 8, 1], ["pdu", 42, 1]]);
    expect(items[0].manufacturer).toBe("APC");
    const [{ seed_rack_layout: again }] = await q("admin", "select public.seed_rack_layout($1)", [project]);
    expect(again).toBe(0);
    const [{ id: rack }] = await q("bob", "select id from public.site_racks where project_id = $1", [project]);
    await expect(q("bob", "insert into public.site_rack_items (project_id, rack_id, u_bottom, u_size, label) values ($1, $2, 2, 2, 'Shelf')", [project, rack])).rejects.toThrow(/taken by APC UPS/);
    await expect(q("bob", "insert into public.site_rack_items (project_id, rack_id, u_bottom, u_size, label) values ($1, $2, 41, 3, 'Shelf')", [project, rack])).rejects.toThrow(/doesn't fit/);
    const [shelf] = await q("bob", "insert into public.site_rack_items (project_id, rack_id, u_bottom, u_size, kind, label) values ($1, $2, 10, 2, 'shelf', 'Shelf') returning id", [project, rack]);
    await q("bob", "update public.site_rack_items set u_bottom = 20 where id = $1", [shelf.id]);
    await q("bob", "delete from public.site_rack_items where id = $1", [shelf.id]);
    expect(await q("carol", "select id from public.site_rack_items where rack_id = $1", [rack])).toHaveLength(0);
  });

  it("markers go on the project's own drawings, linked to its own devices", async () => {
    const [dr] = await q("bob", "insert into public.project_drawings (project_id, title, storage_path, file_name, size_bytes, uploaded_by) values ($1, 'GA', 'x/ga.pdf', 'ga.pdf', 10, $2) returning id", [project, f.u.bob]);
    const [dev] = await q("admin", "select id from public.site_devices where project_id = $1 and archived_at is null limit 1", [project]);
    const [m] = await q("bob", "insert into public.drawing_markers (project_id, drawing_id, x, y, kind, label, device_id) values ($1, $2, 0.25, 0.5, 'touch_panel', 'TP1', $3) returning id, created_by", [project, dr.id, dev.id]);
    expect(m.created_by).toBe(f.u.bob);
    await q("bob", "update public.drawing_markers set x = 0.3 where id = $1", [m.id]);
    await expect(q("bob", "update public.drawing_markers set x = 1.5 where id = $1", [m.id])).rejects.toThrow(/check/);
    const [{ id: other }] = (await db.query("insert into public.projects (organization_id, name, created_by) values ($1, 'Other2', $2) returning id", [f.orgA, f.u.admin])).rows;
    const [od] = (await db.query("insert into public.site_devices (project_id, import_key, name) values ($1, 'o', 'Other device') returning id", [other])).rows;
    await expect(q("bob", "update public.drawing_markers set device_id = $2 where id = $1", [m.id, od.id])).rejects.toThrow(/Device not found/);
    expect(await q("carol", "select id from public.drawing_markers where drawing_id = $1", [dr.id])).toHaveLength(0);
    await q("bob", "delete from public.drawing_markers where id = $1", [m.id]);
  });

  it("markers sit on layers of the same drawing; removing a layer removes its markers", async () => {
    const [dr] = await q("bob", "insert into public.project_drawings (project_id, title, storage_path, file_name, size_bytes, uploaded_by) values ($1, 'GA deck 2', 'x/ga2.pdf', 'ga2.pdf', 10, $2) returning id", [project, f.u.bob]);
    const [dr2] = await q("bob", "insert into public.project_drawings (project_id, title, storage_path, file_name, size_bytes, uploaded_by) values ($1, 'GA deck 3', 'x/ga3.pdf', 'ga3.pdf', 10, $2) returning id", [project, f.u.bob]);
    const [ap] = await q("bob", "insert into public.drawing_layers (project_id, drawing_id, name, kind, color) values ($1, $2, 'Access points', 'access_point', '#0284c7') returning id, organization_id", [project, dr.id]);
    expect(ap.organization_id).toBe(f.orgA);
    await expect(q("bob", "insert into public.drawing_layers (project_id, drawing_id, name) values ($1, $2, 'access POINTS')", [project, dr.id])).rejects.toThrow(/duplicate|unique/);
    const [m] = await q("bob", "insert into public.drawing_markers (project_id, drawing_id, layer_id, x, y, kind, label) values ($1, $2, $3, 0.1, 0.1, 'access_point', 'AP 1') returning id", [project, dr.id, ap.id]);
    await expect(q("bob", "insert into public.drawing_markers (project_id, drawing_id, layer_id, x, y, kind, label) values ($1, $2, $3, 0.1, 0.1, 'access_point', 'AP X')", [project, dr2.id, ap.id])).rejects.toThrow(/Layer not found/);
    expect(await q("carol", "select id from public.drawing_layers where drawing_id = $1", [dr.id])).toHaveLength(0);
    await q("bob", "delete from public.drawing_layers where id = $1", [ap.id]);
    expect(await q("bob", "select id from public.drawing_markers where id = $1", [m.id])).toHaveLength(0);
  });

  it("cable runs sit on a layer of their drawing, stay on the page and go when the layer goes", async () => {
    const [dr] = await q("bob", "insert into public.project_drawings (project_id, title, storage_path, file_name, size_bytes, uploaded_by) values ($1, 'GA deck 4', 'x/ga4.pdf', 'ga4.pdf', 10, $2) returning id", [project, f.u.bob]);
    const [dr2] = await q("bob", "insert into public.project_drawings (project_id, title, storage_path, file_name, size_bytes, uploaded_by) values ($1, 'GA deck 5', 'x/ga5.pdf', 'ga5.pdf', 10, $2) returning id", [project, f.u.bob]);
    const [kp] = await q("bob", "insert into public.drawing_layers (project_id, drawing_id, name, kind, color) values ($1, $2, 'Keypads', 'keypad', '#b07d2b') returning id", [project, dr.id]);
    const [rack] = await q("admin", "insert into public.site_racks (project_id, name) values ($1, 'Rack 3') returning id", [project]);
    const pts = JSON.stringify([{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }]);
    const [c] = await q("bob", "insert into public.drawing_cables (project_id, drawing_id, layer_id, points, label, rack_id) values ($1, $2, $3, $4::jsonb, 'QS link 1', $5) returning id, organization_id, created_by", [project, dr.id, kp.id, pts, rack.id]);
    expect(c.organization_id).toBe(f.orgA);
    expect(c.created_by).toBe(f.u.bob);
    await expect(q("bob", "insert into public.drawing_cables (project_id, drawing_id, layer_id, points) values ($1, $2, $3, $4::jsonb)", [project, dr2.id, kp.id, pts])).rejects.toThrow(/Layer not found/);
    await expect(q("bob", "update public.drawing_cables set points = $2::jsonb where id = $1", [c.id, JSON.stringify([{ x: 0.1, y: 0.2 }, { x: 1.5, y: 0.2 }])])).rejects.toThrow(/on the page/);
    await expect(q("bob", "update public.drawing_cables set points = $2::jsonb where id = $1", [c.id, JSON.stringify([{ x: 0.1, y: 0.2 }])])).rejects.toThrow(/check/);
    expect(await q("carol", "select id from public.drawing_cables where drawing_id = $1", [dr.id])).toHaveLength(0);
    expect(await q("outsider", "select id from public.drawing_cables where drawing_id = $1", [dr.id])).toHaveLength(0);
    await q("bob", "delete from public.drawing_layers where id = $1", [kp.id]);
    expect(await q("bob", "select id from public.drawing_cables where id = $1", [c.id])).toHaveLength(0);
  });

  it("QR short links: only for people who can see the project, one code per target, no odd targets", async () => {
    const [l] = await q("bob", "insert into public.qr_links (code, project_id, target) values ('k3m9x2ab', $1, '/site/cables?panel=MEC552-R2-PP1&all=1') returning organization_id", [project]);
    expect(l.organization_id).toBe(f.orgA);
    await expect(q("bob", "insert into public.qr_links (code, project_id, target) values ('zzzzzzzz', $1, '/site/cables?panel=MEC552-R2-PP1&all=1')", [project])).rejects.toThrow(/duplicate|unique/);
    await expect(q("bob", "insert into public.qr_links (code, project_id, target) values ('yyyyyyyy', $1, 'https://evil.example')", [project])).rejects.toThrow(/check/);
    await expect(q("carol", "insert into public.qr_links (code, project_id, target) values ('xxxxxxxx', $1, '/site/racks')", [project])).rejects.toThrow(/row-level security|Project not found/);
    expect(await q("carol", "select code from public.qr_links where code = 'k3m9x2ab'")).toHaveLength(0);
    expect(await q("outsider", "select code from public.qr_links where code = 'k3m9x2ab'")).toHaveLength(0);
  });
});
