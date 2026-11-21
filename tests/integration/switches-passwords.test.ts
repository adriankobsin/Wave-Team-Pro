import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;
let project: string;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", pm: "project_manager", bob: "employee", carol: "employee" });
  [{ id: project }] = (await db.query("insert into public.projects (organization_id, name, created_by) values ($1, 'MY Seabreeze', $2) returning id", [f.orgA, f.u.admin])).rows;
  await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3), ($1, $2, $4)", [project, f.orgA, f.m.bob, f.m.pm]);
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;

describe("switches", () => {
  it("the project team adds a switch and its ports and types into them; only the project manager removes", async () => {
    const [eq] = await q("bob", "insert into public.site_equipment (project_id, sheet, model) values ($1, 'LEC 403 Sw3', 'C9300L-24P-4X-E') returning id", [project]);
    const [p] = await q("bob", "insert into public.site_ports (project_id, equipment, port, position) values ($1, 'LEC 403 Sw3', 'Gi1/0/1', 1) returning id", [project]);
    await q("bob", "update public.site_ports set vlan = '100', end_device = 'Apple TV - 401', poe_w = 7.5 where id = $1", [p.id]);
    await q("bob", "update public.site_equipment set firmware = '17.15.05', poe_total_w = 740 where id = $1", [eq.id]);
    const [h] = await q("bob", "select changes from public.site_changes where row_id = $1 order by id desc limit 1", [eq.id]);
    expect(h.changes.firmware).toEqual([null, "17.15.05"]);
    await expect(q("bob", "update public.site_ports set archived_at = now() where id = $1", [p.id])).rejects.toThrow(/project manager/);
    await expect(q("bob", "update public.site_equipment set archived_at = now() where id = $1", [eq.id])).rejects.toThrow(/project manager/);
    await q("admin", "update public.site_ports set archived_at = now() where id = $1", [p.id]);
  });

  it("people outside the project can't add or change switches", async () => {
    await expect(q("carol", "insert into public.site_equipment (project_id, sheet) values ($1, 'X')", [project])).rejects.toThrow();
    const r = await as(db, f.claims("carol"), (c) => c("update public.site_equipment set model = 'x' where project_id = $1", [project]));
    expect(r.rowCount).toBe(0);
  });
});

describe("passwords", () => {
  let cred: string;

  it("a project manager stores a login; the password is encrypted in the vault, not in the table", async () => {
    [{ save_credential: cred }] = await q("pm", "select public.save_credential(null, $1, $2, 'Fortigate 200F', 'network', 'https://192.168.10.99', 'admin', true, 'S3cret pass!', null, null)", [f.orgA, project]);
    const [row] = await db.query("select * from public.credentials where id = $1", [cred]).then((r) => r.rows);
    expect(JSON.stringify(row)).not.toContain("S3cret");
    expect(row.secret_id).toBeTruthy();
  });

  it("people allowed see the list and reveal the password; every reveal is logged", async () => {
    expect(await q("pm", "select name, username from public.credentials where id = $1", [cred])).toEqual([{ name: "Fortigate 200F", username: "admin" }]);
    const [{ reveal_credential: pw }] = await q("admin", "select public.reveal_credential($1)", [cred]);
    expect(pw).toBe("S3cret pass!");
    const ev = await q("admin", "select action, user_id from public.credential_events where credential_id = $1 order by id", [cred]);
    expect(ev.map((e) => e.action)).toEqual(["created", "revealed"]);
    expect(ev[1].user_id).toBe(f.u.admin);
  });

  it("staff without the permission, even on the project, and other companies see nothing", async () => {
    for (const who of ["bob", "carol", "outsider"]) {
      expect(await q(who, "select id from public.credentials where id = $1", [cred])).toHaveLength(0);
      await expect(q(who, "select public.reveal_credential($1)", [cred])).rejects.toThrow(/can't see/);
      await expect(q(who, "select public.save_credential(null, $1, null, 'x', 'other', null, null, true, 'y', null, null)", [f.orgA])).rejects.toThrow(/can't change/);
    }
    await expect(q("bob", "insert into public.credentials (organization_id, name) values ($1, 'x')", [f.orgA])).rejects.toThrow(/row-level security|permission denied/);
    await expect(q("bob", "select * from vault.decrypted_secrets")).rejects.toThrow(/permission denied/);
  });

  it("changing keeps or replaces the password; removing wipes it", async () => {
    await q("pm", "select public.save_credential($1, $2, $3, 'Fortigate 200F', 'network', null, 'admin2', false, null, null, 'HA pair')", [cred, f.orgA, project]);
    expect((await q("pm", "select public.reveal_credential($1) as p", [cred]))[0].p).toBe("S3cret pass!");
    await q("pm", "select public.save_credential($1, $2, $3, 'Fortigate 200F', 'network', null, 'admin2', true, 'n3w', null, null)", [cred, f.orgA, project]);
    expect((await q("pm", "select public.reveal_credential($1) as p", [cred]))[0].p).toBe("n3w");
    const [{ secret_id }] = (await db.query("select secret_id from public.credentials where id = $1", [cred])).rows;
    await expect(q("bob", "select public.remove_credential($1)", [cred])).rejects.toThrow(/can't remove/);
    await q("pm", "select public.remove_credential($1)", [cred]);
    expect((await db.query("select secret from vault.secrets where id = $1", [secret_id])).rows[0].secret).toBe("");
    expect(await q("pm", "select id from public.credentials where id = $1 and archived_at is null", [cred])).toHaveLength(0);
  });

  it("new companies give the Project Manager role both permissions", async () => {
    const { rows } = await db.query("select count(*)::int as n from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.organization_id = $1 and r.key = 'project_manager' and rp.permission_key like 'credentials.%'", [f.orgA]);
    expect(rows[0].n).toBe(2);
  });
});

describe("cable testers", () => {
  it("a cable can be tested by several people; the first is kept as tested_by", async () => {
    const [cab] = await q("bob", "insert into public.site_cables (project_id, patch_panel, port, label) values ($1, 'PP1', 1, 'C-1') returning id", [project]).catch(async () =>
      (await db.query("insert into public.site_cables (project_id, organization_id, patch_panel, port, label) values ($1, $2, 'PP1', 1, 'C-1') returning id", [project, f.orgA])).rows);
    await q("bob", "update public.site_cables set test_result = 'passed', tested_by_ids = $2, tested_by = $3 where id = $1", [cab.id, [f.u.bob, f.u.pm], f.u.bob]);
    const [row] = (await db.query("select tested_by, tested_by_ids from public.site_cables where id = $1", [cab.id])).rows;
    expect(row.tested_by_ids).toEqual([f.u.bob, f.u.pm]);
    expect(row.tested_by).toBe(f.u.bob);
    const [h] = (await db.query("select changes from public.site_changes where row_id = $1 order by id desc limit 1", [cab.id])).rows;
    expect(h.changes.tested_by_ids).toEqual([[], [f.u.bob, f.u.pm]]);
  });
});
