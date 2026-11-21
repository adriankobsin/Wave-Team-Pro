import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee" });
  const adminEmail = (await db.query("select email from auth.users where id = $1", [f.u.admin])).rows[0].email;
  const inv = (await as(db, f.claims("outsider"), (q) => q(`insert into public.invitations (organization_id, email, role_id, expires_at)
    values ($1, $2, (select id from public.roles where organization_id = $1 and key = 'super_admin'), now()) returning id`, [f.orgB, adminEmail]))).rows[0].id;
  await as(db, f.claims("admin"), (q) => q("select public.accept_invitation($1)", [inv]));
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const project = async (name: string, country = "TH") =>
  (await db.query("insert into public.projects (organization_id, name, country, manager_membership_id) values ($1, $2, $3, $4) returning id", [f.orgA, name, country, f.m.admin])).rows[0].id as string;

describe("moving a project to another company", () => {
  it("moves the project with its tasks, assignees and members", async () => {
    const id = await project(`Triple Seven ${f.tag}`);
    const task = (await db.query("insert into public.tasks (organization_id, project_id, title, created_by) values ($1, $2, 'Cable cabins', $3) returning id", [f.orgA, id, f.u.admin])).rows[0].id;
    await db.query("insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [task, f.orgA, f.u.admin]);
    await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [id, f.orgA, f.m.bob]);
    const [r] = await q("admin", "select public.move_project($1, $2) r", [id, f.orgB]);
    expect(r.r.mode).toBe("moved");
    const [p] = await q("admin", "select organization_id, country, manager_membership_id from public.projects where id = $1", [id]);
    expect(p.organization_id).toBe(f.orgB);
    expect(p.country).toBe("TH");
    expect(p.manager_membership_id).not.toBeNull(); // the admin's membership in company B
    expect((await q("admin", "select organization_id from public.tasks where id = $1", [task]))[0].organization_id).toBe(f.orgB);
    expect((await q("admin", "select organization_id from public.task_assignees where task_id = $1", [task]))[0].organization_id).toBe(f.orgB);
    // Bob doesn't work in company B, so he is no longer on the project.
    expect((await q("admin", "select count(*)::int n from public.project_members where project_id = $1", [id]))[0].n).toBe(0);
  });

  it("copies a project with recorded time and closes the original, keeping its history", async () => {
    const id = await project(`Kensho ${f.tag}`, "FR");
    await q("admin", "select public.clock_on($1, 'clock_in', $2, null)", [f.orgA, id]);
    await q("admin", "select public.clock_on($1, 'clock_out', null, null)", [f.orgA]);
    const [r] = await q("admin", "select public.move_project($1, $2) r", [id, f.orgB]);
    expect(r.r.mode).toBe("copied");
    const [orig] = await q("admin", "select organization_id, status from public.projects where id = $1", [id]);
    expect(orig).toEqual({ organization_id: f.orgA, status: "completed" });
    const [copy] = await q("admin", "select organization_id, name, country, status from public.projects where id = $1", [r.r.project_id]);
    expect(copy).toEqual({ organization_id: f.orgB, name: `Kensho ${f.tag}`, country: "FR", status: "active" });
    expect((await q("admin", "select count(*)::int n from public.attendance_events where project_id = $1", [id]))[0].n).toBeGreaterThan(0);
  });

  it("refuses people who don't manage projects in both companies", async () => {
    const id = await project(`Nero ${f.tag}`, "ES");
    await expect(q("bob", "select public.move_project($1, $2)", [id, f.orgB])).rejects.toThrow(/both companies/);
    await expect(q("outsider", "select public.move_project($1, $2)", [id, f.orgB])).rejects.toThrow(/both companies/);
  });
});

describe("my_companies (Group Hub in one call)", () => {
  it("lists each active company with the viewer's rights there", async () => {
    const rows = await q("admin", "select organization_id, can_staff, can_settings from public.my_companies()");
    expect(rows.map((r) => r.organization_id).sort()).toEqual([f.orgA, f.orgB].sort());
    expect(rows.every((r) => r.can_staff && r.can_settings)).toBe(true);
    const bob = await q("bob", "select organization_id, can_staff, can_settings from public.my_companies()");
    expect(bob).toEqual([{ organization_id: f.orgA, can_staff: true, can_settings: false }]);
  });
});

describe("staffing a project from another company", () => {
  it("adds someone from company A to company B and onto B's project", async () => {
    const [p] = await q("admin", "insert into public.projects (organization_id, name, created_by) values ($1, $2, $3) returning id", [f.orgB, `Soar ${f.tag}`, f.u.admin]);
    const role = await f.role(f.orgB, "employee");
    const [{ m }] = await q("admin", "select public.add_to_company($1, $2, $3) m", [f.orgB, f.u.bob, role]);
    await q("admin", "insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [p.id, f.orgB, m]);
    expect((await q("bob", "select count(*)::int n from public.project_members where project_id = $1", [p.id]))[0].n).toBe(1);
  });
});
