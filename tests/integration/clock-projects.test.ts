import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;
let pA: string;
let pA2: string;
let pB: string;
let mB: string;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee", cara: "employee" });
  // Bob also works for company B.
  const email = (await db.query("select email from auth.users where id = $1", [f.u.bob])).rows[0].email;
  const inv = (await as(db, f.claims("outsider"), (q) => q(`insert into public.invitations (organization_id, email, role_id, expires_at)
    values ($1, $2, (select id from public.roles where organization_id = $1 and key = 'employee'), now()) returning id`, [f.orgB, email]))).rows[0].id;
  mB = (await as(db, f.claims("bob"), (q) => q("select public.accept_invitation($1) id", [inv]))).rows[0].id;
  const proj = async (org: string, name: string, member: string) => {
    const id = (await db.query("insert into public.projects (organization_id, name, status) values ($1, $2, 'active') returning id", [org, name])).rows[0].id as string;
    await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [id, org, member]);
    return id;
  };
  pA = await proj(f.orgA, "Aurora refit", f.m.bob);
  pA2 = await proj(f.orgA, "Office", f.m.bob);
  pB = await proj(f.orgB, "Meridian CCTV", mB);
  // Bob chooses his own projects (individual exception); "cara" below is a basic employee.
  for (const [org, m] of [[f.orgA, f.m.bob], [f.orgB, mB]]) {
    await db.query("insert into public.scoped_permission_overrides (organization_id, membership_id, permission_key, effect, reason) values ($1, $2, 'work.self_manage', 'grant', 'test')", [org, m]);
  }
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const state = async (m: string) => (await q("bob", "select public.attendance_state($1) s", [m]))[0].s;

describe("clock in by company and project", () => {
  it("records the project and refuses another company's project", async () => {
    await expect(q("bob", "select public.clock_on($1, 'clock_in', $2)", [f.orgA, pB])).rejects.toThrow(/cannot clock in to that project/);
    await q("bob", "select public.clock_on($1, 'clock_in', $2)", [f.orgA, pA]);
    const [row] = await q("bob", "select project_id from public.attendance_events where membership_id = $1 and kind = 'clock_in' order by occurred_at desc limit 1", [f.m.bob]);
    expect(row.project_id).toBe(pA);
  });

  it("switches project without clocking out", async () => {
    await q("bob", "select public.clock_on($1, 'switch', $2)", [f.orgA, pA2]);
    expect(await state(f.m.bob)).toBe("in");
    const [st] = await q("bob", "select organization_id, project_name from public.my_clock_status()");
    expect(st).toEqual({ organization_id: f.orgA, project_name: "Office" });
  });

  it("clocking in at another company clocks you out of the first at the same moment", async () => {
    await q("bob", "select public.clock_on($1, 'break_start')", [f.orgA]);
    await q("bob", "select public.clock_on($1, 'clock_in', $2)", [f.orgB, pB]);
    expect(await state(f.m.bob)).toBe("out");
    expect(await state(mB)).toBe("in");
    const [last] = await q("bob", "select kind, note from public.attendance_events where membership_id = $1 order by occurred_at desc limit 1", [f.m.bob]);
    expect(last).toEqual({ kind: "clock_out", note: "Clocked in at another company" });
    const status = await q("bob", "select organization_id from public.my_clock_status()");
    expect(status).toEqual([{ organization_id: f.orgB }]);
  });

  it("the old clock() still works and HR in company A can't see company B punches", async () => {
    await q("bob", "select public.clock($1, 'clock_out')", [f.orgB]);
    expect(await state(mB)).toBe("out");
    expect(await q("admin", "select id from public.attendance_events where membership_id = $1", [mB])).toHaveLength(0);
  });

  it("clock rows can only be written by the server", async () => {
    const [{ id }] = await q("bob", "select public.ensure_timesheet($1, '2026-10-19') id", [f.orgA]);
    await expect(q("bob", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, project_id, hours, from_clock) values ($1, $2, '2026-10-20', $3, 5.5, true)", [f.orgA, id, pA])).rejects.toThrow(/comes from your clock-ins/);
  });

  it("basic employees can't choose a project: they're clocked in to the one management assigned", async () => {
    await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [pA, f.orgA, f.m.cara]);
    await expect(q("cara", "select public.clock_on($1, 'clock_in', $2)", [f.orgA, pA])).rejects.toThrow(/assigned by your manager/);
    await db.query("update public.organization_memberships set assigned_project_id = $1 where id = $2", [pA2, f.m.cara]);
    const [a] = await q("cara", "select project_name, can_choose from public.my_assignments() where organization_id = $1", [f.orgA]);
    expect(a).toEqual({ project_name: "Office", can_choose: false });
    await q("cara", "select public.clock_on($1, 'clock_in')", [f.orgA]);
    const [row] = await q("cara", "select project_id from public.attendance_events where membership_id = $1 and kind = 'clock_in' order by occurred_at desc limit 1", [f.m.cara]);
    expect(row.project_id).toBe(pA2);
    await q("cara", "select public.clock_on($1, 'clock_out')", [f.orgA]);
    // A shift with a project today wins over the standing assignment.
    await db.query("insert into public.shifts (organization_id, membership_id, starts_at, ends_at, project_id) values ($1, $2, now() - interval '1 hour', now() + interval '6 hours', $3)", [f.orgA, f.m.cara, pA]);
    await q("cara", "select public.clock_on($1, 'clock_in')", [f.orgA]);
    const [row2] = await q("cara", "select project_id from public.attendance_events where membership_id = $1 and kind = 'clock_in' order by occurred_at desc limit 1", [f.m.cara]);
    expect(row2.project_id).toBe(pA);
  });
});
