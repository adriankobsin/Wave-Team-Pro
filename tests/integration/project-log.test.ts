import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;
let project: string;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee", carol: "employee" });
  [{ id: project }] = (await db.query("insert into public.projects (organization_id, name, created_by) values ($1, 'Harbour refit', $2) returning id", [f.orgA, f.u.admin])).rows;
  await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [project, f.orgA, f.m.bob]);
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;

describe("project log", () => {
  it("the project team logs deliveries; others in the company can't", async () => {
    const [n] = await q("bob", "insert into public.project_notes (project_id, kind, title, supplier, reference, amount, currency) values ($1, 'delivery', '40 access points delivered', 'CEF', 'PO-1182', 2140.5, 'GBP') returning id, created_by, organization_id", [project]);
    expect(n.created_by).toBe(f.u.bob);
    expect(n.organization_id).toBe(f.orgA);
    await expect(q("carol", "insert into public.project_notes (project_id, title) values ($1, 'Not my project')", [project])).rejects.toThrow(/projects you work on|row-level security/);
    expect(await q("admin", "select id from public.project_notes where id = $1", [n.id])).toHaveLength(1);
    expect(await q("carol", "select id from public.project_notes where id = $1", [n.id])).toHaveLength(0);
    expect(await q("outsider", "select id from public.project_notes where id = $1", [n.id])).toHaveLength(0);
  });

  it("only the author or the project manager changes an entry", async () => {
    const [n] = await q("admin", "insert into public.project_notes (project_id, kind, title) values ($1, 'order', 'Ordered patch leads') returning id", [project]);
    const none = await as(db, f.claims("bob"), (c) => c("update public.project_notes set title = 'Changed' where id = $1", [n.id]));
    expect(none.rowCount).toBe(0);
    await q("admin", "update public.project_notes set archived_at = now() where id = $1", [n.id]);
    expect((await q("bob", "select archived_at from public.project_notes where id = $1", [n.id]))[0].archived_at).not.toBeNull();
    await expect(q("bob", "update public.project_notes set created_by = $1", [f.u.bob])).rejects.toThrow(/permission denied/);
  });
});
