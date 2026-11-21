import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", pa: "va_admin", bob: "employee" });
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const queued = async (kind: string, ref: string) => (await db.query("select status from public.calendar_sync where kind = $1 and ref_id = $2", [kind, ref])).rows[0]?.status;

describe("Outlook calendar queue", () => {
  it("queues a task with a due date when it's assigned, but not one without", async () => {
    const [t] = await q("admin", "insert into public.tasks (organization_id, title, due_date) values ($1, 'Fit sauna lights', '2026-11-20') returning id", [f.orgA]);
    await q("admin", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [t.id, f.orgA, f.u.bob]);
    expect(await queued("task", t.id)).toBe("pending");
    const [u] = await q("admin", "insert into public.tasks (organization_id, title) values ($1, 'No date') returning id", [f.orgA]);
    expect(await queued("task", u.id)).toBeUndefined();
  });

  it("queues shifts, project team changes and approved leave", async () => {
    const [s] = (await db.query("insert into public.shifts (organization_id, membership_id, starts_at, ends_at) values ($1, $2, now() + interval '1 day', now() + interval '1 day 8 hours') returning id", [f.orgA, f.m.bob])).rows;
    expect(await queued("shift", s.id)).toBe("pending");
    const [p] = (await db.query("insert into public.projects (organization_id, name, start_date) values ($1, 'Kensho', '2026-11-10') returning id", [f.orgA])).rows;
    await db.query("insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [p.id, f.orgA, f.m.bob]);
    expect(await queued("project", p.id)).toBe("pending");
  });

  it("lets PAs and super admins see the queue, not employees", async () => {
    expect((await q("pa", "select count(*)::int n from public.calendar_sync where organization_id = $1", [f.orgA]))[0].n).toBeGreaterThan(0);
    expect((await q("bob", "select count(*)::int n from public.calendar_sync"))[0].n).toBe(0);
    expect((await q("pa", "select public.has_permission($1, 'invites.send') ok", [f.orgA]))[0].ok).toBe(true);
    expect((await q("bob", "select public.has_permission($1, 'invites.send') ok", [f.orgA]))[0].ok).toBe(false);
  });
});

describe("who may send invites", () => {
  it("super admins, PAs and management; not employees or bookkeepers", async () => {
    const rows = (await db.query(`select r.key, exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = 'invites.send') ok
      from public.roles r where r.organization_id = $1`, [f.orgA])).rows as { key: string; ok: boolean }[];
    const ok = Object.fromEntries(rows.map((r) => [r.key, r.ok]));
    for (const k of ["super_admin", "va_admin", "director", "hr_manager", "project_manager"]) expect(ok[k], k).toBe(true);
    expect(ok.employee).toBe(false);
    expect(ok.bookkeeper).toBe(false);
  });
});

describe("email signatures", () => {
  it("each person keeps their own", async () => {
    await q("pa", "insert into public.email_signatures (user_id, signature) values ($1, 'Jane\nPA, Acme')", [f.u.pa]);
    expect((await q("pa", "select signature from public.email_signatures"))[0].signature).toContain("PA, Acme");
    expect(await q("bob", "select * from public.email_signatures")).toEqual([]);
    await expect(q("bob", "insert into public.email_signatures (user_id, signature) values ($1, 'x')", [f.u.pa])).rejects.toThrow(/row-level security/);
  });
});
