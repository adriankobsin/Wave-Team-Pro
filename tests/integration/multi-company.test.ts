import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, createAuthUser } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee" });
  // The admin also runs company B (as a group admin would).
  const adminEmail = (await db.query("select email from auth.users where id = $1", [f.u.admin])).rows[0].email;
  const inv = (await as(db, f.claims("outsider"), (q) => q(`insert into public.invitations (organization_id, email, role_id, expires_at)
    values ($1, $2, (select id from public.roles where organization_id = $1 and key = 'super_admin'), now()) returning id`, [f.orgB, adminEmail]))).rows[0].id;
  await as(db, f.claims("admin"), (q) => q("select public.accept_invitation($1)", [inv]));
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const invite = (who: string, org: string, email: string, key: string) =>
  q(who, `insert into public.invitations (organization_id, email, role_id, expires_at)
    values ($1, $2, (select id from public.roles where organization_id = $1 and key = $3), now()) returning id`, [org, email, key]);

describe("one person in several companies", () => {
  it("a new hire invited to two companies joins both and gets separate roles", async () => {
    const email = `dual-${f.tag}@example.test`;
    await invite("admin", f.orgA, email, "employee");
    await invite("admin", f.orgB, email, "hr_manager");
    const uid = await createAuthUser(db, email, { name: "Dual" });
    const claims = { sub: uid };
    const pending = (await as(db, claims, (c) => c("select invitation_id, organization_id from public.list_my_pending_invitations()"))).rows;
    expect(pending.map((p) => p.organization_id).sort()).toEqual([f.orgA, f.orgB].sort());
    for (const p of pending) await as(db, claims, (c) => c("select public.accept_invitation($1)", [p.invitation_id]));
    const roles = (await as(db, claims, (c) => c(`select m.organization_id, r.key from public.organization_memberships m
      join public.membership_role_assignments a on a.membership_id = m.id join public.roles r on r.id = a.role_id where m.user_id = $1`, [uid]))).rows;
    expect(roles).toEqual(expect.arrayContaining([{ organization_id: f.orgA, key: "employee" }, { organization_id: f.orgB, key: "hr_manager" }]));
  });

  it("an existing member can be added to another company and joins with one click", async () => {
    const [{ email }] = (await db.query("select email from auth.users where id = $1", [f.u.bob])).rows;
    await invite("admin", f.orgB, email, "employee");
    const [p] = await q("bob", "select invitation_id from public.list_my_pending_invitations()");
    await q("bob", "select public.accept_invitation($1)", [p.invitation_id]);
    expect((await q("bob", "select count(*)::int n from public.organization_memberships where user_id = $1 and status = 'active'", [f.u.bob]))[0].n).toBe(2);
  });

  it("only admins of the other company can add people there", async () => {
    await expect(invite("bob", f.orgB, `x-${f.tag}@example.test`, "employee")).rejects.toThrow(/users.invite|row-level security/);
  });
});

describe("adding a registered person straight into another company", () => {
  it("creates an active membership with the role, no invitation needed", async () => {
    const role = await f.role(f.orgB, "employee");
    const uid = await createAuthUser(db, `direct-${f.tag}@example.test`, { name: "Direct" });
    await db.query("insert into public.organization_memberships (organization_id, user_id) values ($1, $2)", [f.orgA, uid]);
    const [{ m }] = await q("admin", "select public.add_to_company($1, $2, $3, 'Engineer') m", [f.orgB, uid, role]);
    const [row] = await q("admin", "select status, job_title from public.organization_memberships where id = $1", [m]);
    expect(row).toEqual({ status: "active", job_title: "Engineer" });
    const roles = await q("admin", "select role_id from public.membership_role_assignments where membership_id = $1", [m]);
    expect(roles.map((r) => r.role_id)).toEqual([role]);
    // Running it again is harmless.
    expect((await q("admin", "select public.add_to_company($1, $2, $3) m", [f.orgB, uid, role]))[0].m).toBe(m);
  });

  it("turns a pending invitation for a registered person into membership", async () => {
    const email = `late-${f.tag}@example.test`;
    const uid = await createAuthUser(db, email, { name: "Late" });
    await db.query(`insert into public.organization_memberships (organization_id, user_id) values ($1, $2)`, [f.orgA, uid]);
    const [inv] = await invite("admin", f.orgB, email, "employee");
    await q("admin", "select public.add_invited_now($1)", [inv.id]);
    expect((await q("admin", "select status from public.invitations where id = $1", [inv.id]))[0].status).toBe("accepted");
    expect((await q("admin", "select count(*)::int n from public.organization_memberships where user_id = $1 and organization_id = $2 and status = 'active'", [uid, f.orgB]))[0].n).toBe(1);
  });

  it("is refused for people without invite rights there", async () => {
    const role = await f.role(f.orgA, "employee");
    await expect(q("bob", "select public.add_to_company($1, $2, $3)", [f.orgA, f.u.outsider, role])).rejects.toThrow(/can't add people/);
  });
});
