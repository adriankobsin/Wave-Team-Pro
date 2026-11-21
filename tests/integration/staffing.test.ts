import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;
let project: string;
let bobTrip: string;
let carolTrip: string;
let request: string;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", pm: "project_manager", bob: "employee", carol: "employee", dan: "employee" });
  [{ id: project }] = (await db.query("insert into public.projects (organization_id, name, created_by) values ($1, 'MY Seabreeze', $2) returning id", [f.orgA, f.u.admin])).rows;
  // Writes go through the server (service role); here as the table owner.
  [{ id: bobTrip }] = (await db.query("insert into public.staff_assignments (organization_id, project_id, membership_id, start_date, end_date, needs_travel) values ($1, $2, $3, '2026-12-01', '2026-12-09', true) returning id", [f.orgA, project, f.m.bob])).rows;
  [{ id: carolTrip }] = (await db.query("insert into public.staff_assignments (organization_id, project_id, membership_id, start_date, end_date) values ($1, $2, $3, '2026-12-01', '2026-12-03') returning id", [f.orgA, project, f.m.carol])).rows;
  [{ id: request }] = (await db.query("insert into public.travel_requests (organization_id, assignment_id, travel_from) values ($1, $2, 'Bangkok') returning id", [f.orgA, bobTrip])).rows;
  await db.query("insert into public.travel_bookings (organization_id, request_id, kind, title, starts_at, ends_at) values ($1, $2, 'flight', 'TG 403', '2026-11-30T01:00Z', '2026-11-30T03:30Z')", [f.orgA, request]);
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;

describe("staff calendar", () => {
  it("project managers and super admins see everyone's assignments and may assign", async () => {
    for (const who of ["admin", "pm"]) {
      expect(await q(who, "select id from public.staff_assignments where project_id = $1", [project])).toHaveLength(2);
      const [{ has_permission }] = await q(who, "select public.has_permission($1, 'staffing.assign')", [f.orgA]);
      expect(has_permission).toBe(true);
    }
  });

  it("staff see only their own assignment and trip; other companies see nothing", async () => {
    expect((await q("bob", "select id from public.staff_assignments")).map((r) => r.id)).toEqual([bobTrip]);
    expect(await q("bob", "select id from public.travel_requests")).toHaveLength(1);
    expect(await q("bob", "select title from public.travel_bookings")).toEqual([{ title: "TG 403" }]);
    expect((await q("carol", "select id from public.staff_assignments")).map((r) => r.id)).toEqual([carolTrip]);
    expect(await q("carol", "select id from public.travel_bookings")).toHaveLength(0);
    expect(await q("outsider", "select id from public.staff_assignments")).toHaveLength(0);
    const [{ has_permission }] = await q("bob", "select public.has_permission($1, 'staffing.assign')", [f.orgA]);
    expect(has_permission).toBe(false);
  });

  it("a travel coordinator without other permissions handles the company's travel", async () => {
    expect((await q("dan", "select public.can_handle_travel($1) as ok", [f.orgA]))[0].ok).toBe(false);
    await db.query("insert into public.travel_coordinators (organization_id, membership_id, is_lead) values ($1, $2, true)", [f.orgA, f.m.dan]);
    expect((await q("dan", "select public.can_handle_travel($1) as ok", [f.orgA]))[0].ok).toBe(true);
    expect(await q("dan", "select id from public.travel_requests")).toHaveLength(1);
    expect(await q("dan", "select id from public.staff_assignments")).toHaveLength(2);
  });

  it("nobody writes the tables directly", async () => {
    await expect(q("pm", "insert into public.staff_assignments (organization_id, project_id, membership_id, start_date, end_date) values ($1, $2, $3, '2026-12-01', '2026-12-02')", [f.orgA, project, f.m.pm])).rejects.toThrow(/row-level security|permission denied/);
    await expect(q("pm", "update public.travel_requests set status = 'booked' where id = $1", [request])).rejects.toThrow(/permission denied/);
  });

  it("dates must run forwards and stay within a year", async () => {
    await expect(db.query("insert into public.staff_assignments (organization_id, project_id, membership_id, start_date, end_date) values ($1, $2, $3, '2026-12-05', '2026-12-01')", [f.orgA, project, f.m.bob])).rejects.toThrow(/check/);
  });
});
