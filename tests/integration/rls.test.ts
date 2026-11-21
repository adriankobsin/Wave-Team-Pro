import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, createAuthUser } from "./support/db";

/**
 * Row Level Security, privilege-escalation and tenancy tests for Phase A.
 * Scenario:
 *   Org A (Acme Marine): alice = Super Admin, carol = Admin/VA, dave = Bookkeeper, bob = Employee
 *   Org B (Blue Yachts): eve = Super Admin
 *   paul = platform owner (provisions orgs, no tenant access)
 */

let db: Client;
const u: Record<string, string> = {};
let orgA: string;
let orgB: string;
const m: Record<string, string> = {}; // membership ids
const role: Record<string, string> = {}; // org A role ids by key

const claims = (who: string, extra: { aal?: "aal1" | "aal2" } = {}) => ({ sub: u[who], ...extra });

async function invite(by: string, org: string, email: string, roleKey: string) {
  return as(db, claims(by), async (q) => {
    const { rows } = await q(
      `insert into public.invitations (organization_id, email, role_id, expires_at)
       values ($1, $2, (select id from public.roles where organization_id = $1 and key = $3), now())
       returning id`,
      [org, email, roleKey],
    );
    return rows[0].id as string;
  });
}

async function accept(who: string, invitationId: string) {
  return as(db, claims(who), async (q) => {
    const { rows } = await q("select public.accept_invitation($1) as id", [invitationId]);
    return rows[0].id as string;
  });
}

async function can(who: string, org: string, perm: string, aal: "aal1" | "aal2" = "aal1") {
  return as(db, claims(who, { aal }), async (q) => {
    const { rows } = await q("select public.has_permission($1, $2) as ok", [org, perm]);
    return rows[0].ok as boolean;
  });
}

beforeAll(async () => {
  db = await connect();
  for (const name of ["paul", "alice", "bob", "carol", "dave", "eve", "mallory"]) {
    u[name] = await createAuthUser(db, `${name}@example.test`);
  }
  u.unconfirmed = await createAuthUser(db, "unconfirmed@example.test", { confirmed: false });
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.paul]);

  orgA = await as(db, claims("paul"), async (q) => {
    const { rows } = await q("select public.create_organization('Acme Marine', 'acme', 'GBP', 'Europe/London', 'GB') as id");
    return rows[0].id;
  });
  orgB = await as(db, claims("paul"), async (q) => {
    const { rows } = await q("select public.create_organization('Blue Yachts', 'blue', 'THB', 'Asia/Bangkok', 'TH') as id");
    return rows[0].id;
  });

  const invA = await as(db, claims("paul"), async (q) =>
    (await q("select public.create_initial_invitation($1, 'alice@example.test', 'Alice Admin') as id", [orgA])).rows[0].id,
  );
  m.alice = await accept("alice", invA);
  const invB = await as(db, claims("paul"), async (q) =>
    (await q("select public.create_initial_invitation($1, 'eve@example.test') as id", [orgB])).rows[0].id,
  );
  m.eve = await accept("eve", invB);

  m.bob = await accept("bob", await invite("alice", orgA, "bob@example.test", "employee"));
  m.carol = await accept("carol", await invite("alice", orgA, "carol@example.test", "va_admin"));
  m.dave = await accept("dave", await invite("alice", orgA, "dave@example.test", "bookkeeper"));

  const { rows } = await db.query("select id, key from public.roles where organization_id = $1", [orgA]);
  for (const r of rows) role[r.key] = r.id;
});

afterAll(async () => {
  await db?.end();
});

describe("bootstrap", () => {
  it("seeds role templates for every organization", async () => {
    const { rows } = await db.query("select key from public.roles where organization_id = $1 order by key", [orgA]);
    expect(rows.map((r) => r.key)).toEqual([
      "bookkeeper", "director", "employee", "hr_manager", "project_manager", "super_admin", "team_leader", "va_admin",
    ]);
  });

  it("gives the accepted super admin every permission and the employee only self-service", async () => {
    expect(await can("alice", orgA, "roles.manage")).toBe(true);
    expect(await can("alice", orgA, "expenses.export")).toBe(true);
    expect(await can("bob", orgA, "expenses.create")).toBe(true);
    expect(await can("bob", orgA, "users.invite")).toBe(false);
    expect(await can("bob", orgA, "expenses.view.all")).toBe(false);
  });

  it("does not let non-platform users create organizations", async () => {
    await expect(
      as(db, claims("mallory"), (q) => q("select public.create_organization('Evil', 'evil', 'USD', 'UTC', 'US')")),
    ).rejects.toThrow(/platform owners/);
  });

  it("does not let the platform owner bootstrap an org that already has members", async () => {
    await expect(
      as(db, claims("paul"), (q) => q("select public.create_initial_invitation($1, 'mallory@example.test')", [orgA])),
    ).rejects.toThrow(/already has members/);
  });
});

describe("anonymous access", () => {
  it("returns nothing and grants no table privileges", async () => {
    for (const table of ["profiles", "organizations", "organization_memberships", "roles", "invitations", "audit_logs"]) {
      await expect(as(db, null, (q) => q(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("cannot execute security-definer functions", async () => {
    await expect(as(db, null, (q) => q("select public.has_permission($1, 'users.view')", [orgA]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("tenant isolation", () => {
  it("hides other organizations entirely", async () => {
    const orgs = await as(db, claims("eve"), (q) => q("select id from public.organizations"));
    expect(orgs.rows.map((r) => r.id)).toEqual([orgB]);
    const members = await as(db, claims("eve"), (q) =>
      q("select id from public.organization_memberships where organization_id = $1", [orgA]),
    );
    expect(members.rowCount).toBe(0);
    const roles = await as(db, claims("eve"), (q) => q("select id from public.roles where organization_id = $1", [orgA]));
    expect(roles.rowCount).toBe(0);
  });

  it("hides profiles of people you share no organization with (direct object access)", async () => {
    const res = await as(db, claims("eve"), (q) => q("select id from public.profiles where id = $1", [u.bob]));
    expect(res.rowCount).toBe(0);
    const own = await as(db, claims("bob"), (q) => q("select id from public.profiles where id = $1", [u.carol]));
    expect(own.rowCount).toBe(1);
  });

  it("evaluates permissions per organization", async () => {
    expect(await can("eve", orgB, "roles.manage")).toBe(true);
    expect(await can("eve", orgA, "users.view")).toBe(false);
    expect(await can("alice", orgB, "users.view")).toBe(false);
  });

  it("rejects writes into another organization", async () => {
    await expect(
      as(db, claims("eve"), (q) =>
        q("insert into public.departments (organization_id, name) values ($1, 'Hijack')", [orgA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("prevents cross-organization references even for trusted writers", async () => {
    const teamB = (
      await db.query("insert into public.teams (organization_id, name) values ($1, 'B crew') returning id", [orgB])
    ).rows[0].id;
    await expect(
      db.query("insert into public.team_memberships (organization_id, team_id, membership_id) values ($1, $2, $3)", [
        orgA,
        teamB,
        m.bob,
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  it("gives the platform owner no access to tenant data", async () => {
    const res = await as(db, claims("paul"), (q) =>
      q("select id from public.organization_memberships where organization_id = $1", [orgA]),
    );
    expect(res.rowCount).toBe(0);
    expect(await can("paul", orgA, "users.view")).toBe(false);
  });
});

describe("privilege escalation guards", () => {
  it("blocks an employee from granting themselves or others roles", async () => {
    await expect(
      as(db, claims("bob"), (q) =>
        q(
          "insert into public.membership_role_assignments (organization_id, membership_id, role_id) values ($1, $2, $3)",
          [orgA, m.bob, role.super_admin],
        ),
      ),
    ).rejects.toThrow(/row-level security|own role/);
  });

  it("blocks a VA from assigning a role with permissions they do not hold", async () => {
    await expect(
      as(db, claims("carol"), (q) =>
        q(
          "insert into public.membership_role_assignments (organization_id, membership_id, role_id) values ($1, $2, $3)",
          [orgA, m.bob, role.bookkeeper],
        ),
      ),
    ).rejects.toThrow(/do not hold/);
  });

  it("lets a VA assign a role within their own permissions", async () => {
    await as(
      db,
      claims("carol"),
      (q) =>
        q(
          "insert into public.membership_role_assignments (organization_id, membership_id, role_id) values ($1, $2, $3)",
          [orgA, m.dave, role.employee],
        ),
      { rollback: true },
    );
  });

  it("blocks self-assignment even for admins", async () => {
    await expect(
      as(db, claims("carol"), (q) =>
        q(
          "insert into public.membership_role_assignments (organization_id, membership_id, role_id) values ($1, $2, $3)",
          [orgA, m.carol, role.employee],
        ),
      ),
    ).rejects.toThrow(/own role/);
  });

  it("blocks adding a permission you do not hold to a role", async () => {
    await expect(
      as(db, claims("carol"), (q) =>
        q("insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'expenses.approve')", [
          orgA,
          role.employee,
        ]),
      ),
    ).rejects.toThrow(/do not hold/);
  });

  it("blocks editing a role assigned to yourself", async () => {
    await expect(
      as(db, claims("carol"), (q) =>
        q("insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'users.view')", [
          orgA,
          role.va_admin,
        ]),
      ),
    ).rejects.toThrow(/assigned to you|duplicate/);
  });

  it("keeps the Super Admin role immutable", async () => {
    await expect(
      as(db, claims("alice"), (q) =>
        q("delete from public.role_permissions where role_id = $1 and permission_key = 'audit.view'", [role.super_admin]),
      ),
    ).rejects.toThrow(/cannot be modified/);
    await expect(
      as(db, claims("alice"), (q) => q("update public.roles set name = 'Owner' where id = $1", [role.super_admin])),
    ).rejects.toThrow(/cannot be modified/);
  });

  it("blocks inviting someone with a role above your own", async () => {
    await expect(invite("carol", orgA, "mallory@example.test", "super_admin")).rejects.toThrow(/do not hold/);
  });

  it("prevents an organization from losing its last Super Admin", async () => {
    await expect(
      db.query("delete from public.membership_role_assignments where membership_id = $1 and role_id = $2", [
        m.alice,
        role.super_admin,
      ]),
    ).rejects.toThrow(/at least one active Super Admin/);
  });

  it("prevents changing your own employment status", async () => {
    await expect(
      as(db, claims("alice"), (q) =>
        q("update public.organization_memberships set status = 'deactivated' where id = $1", [m.alice]),
      ),
    ).rejects.toThrow(/own employment status/);
  });

  it("silently filters membership edits by people without users.edit", async () => {
    const res = await as(db, claims("bob"), (q) =>
      q("update public.organization_memberships set job_title = 'CEO' where id = $1", [m.bob]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("does not allow Super Admins to be restricted with deny overrides", async () => {
    // Make a second super admin so alice is not the actor on herself.
    await db.query(
      "insert into public.membership_role_assignments (organization_id, membership_id, role_id) values ($1, $2, $3)",
      [orgA, m.dave, role.super_admin],
    );
    await expect(
      as(db, claims("dave"), (q) =>
        q(
          `insert into public.scoped_permission_overrides (organization_id, membership_id, permission_key, effect, reason)
           values ($1, $2, 'roles.manage', 'deny', 'lockout attempt')`,
          [orgA, m.alice],
        ),
      ),
    ).rejects.toThrow(/cannot be restricted/);
    await db.query("delete from public.membership_role_assignments where membership_id = $1 and role_id = $2", [
      m.dave,
      role.super_admin,
    ]);
  });
});

describe("overrides", () => {
  it("deny overrides beat role grants and expire", async () => {
    expect(await can("bob", orgA, "leave.request")).toBe(true);
    const id = await as(db, claims("alice"), async (q) => {
      const { rows } = await q(
        `insert into public.scoped_permission_overrides (organization_id, membership_id, permission_key, effect, reason)
         values ($1, $2, 'leave.request', 'deny', 'Probation period') returning id`,
        [orgA, m.bob],
      );
      return rows[0].id;
    });
    expect(await can("bob", orgA, "leave.request")).toBe(false);
    await db.query("set session_replication_role = replica"); // bypass guards to backdate expiry
    await db.query("update public.scoped_permission_overrides set expires_at = now() - interval '1 minute' where id = $1", [id]);
    await db.query("set session_replication_role = origin");
    expect(await can("bob", orgA, "leave.request")).toBe(true);
  });

  it("grant overrides add a single permission", async () => {
    expect(await can("bob", orgA, "reports.view")).toBe(false);
    await as(db, claims("alice"), (q) =>
      q(
        `insert into public.scoped_permission_overrides (organization_id, membership_id, permission_key, effect, reason)
         values ($1, $2, 'reports.view', 'grant', 'Covering for manager')`,
        [orgA, m.bob],
      ),
    );
    expect(await can("bob", orgA, "reports.view")).toBe(true);
    const perms = await as(db, claims("bob"), (q) => q("select permission_key from public.my_permissions($1)", [orgA]));
    expect(perms.rows.map((r) => r.permission_key)).toContain("reports.view");
  });

  it("team-scoped roles do not leak to organization scope", async () => {
    const team = (
      await db.query("insert into public.teams (organization_id, name) values ($1, 'Deck crew') returning id", [orgA])
    ).rows[0].id;
    await as(db, claims("alice"), (q) =>
      q(
        `insert into public.membership_role_assignments (organization_id, membership_id, role_id, scope_type, scope_id)
         values ($1, $2, $3, 'team', $4)`,
        [orgA, m.bob, role.team_leader, team],
      ),
    );
    const scoped = await as(db, claims("bob"), (q) =>
      q("select public.has_permission($1, 'leave.approve', 'team', $2) as ok", [orgA, team]),
    );
    expect(scoped.rows[0].ok).toBe(true);
    expect(await can("bob", orgA, "leave.approve")).toBe(false);
  });
});

describe("MFA enforcement for sensitive permissions", () => {
  it("requires an aal2 session when the organization enables it", async () => {
    await as(db, claims("alice"), (q) =>
      q("update public.organization_settings set mfa_required_for_sensitive = true where organization_id = $1", [orgA]),
    );
    expect(await can("alice", orgA, "roles.manage", "aal1")).toBe(false);
    expect(await can("alice", orgA, "roles.manage", "aal2")).toBe(true);
    expect(await can("alice", orgA, "users.view", "aal1")).toBe(true); // not sensitive
    await as(db, claims("alice", { aal: "aal2" }), (q) =>
      q("update public.organization_settings set mfa_required_for_sensitive = false where organization_id = $1", [orgA]),
    );
  });
});

describe("invitations", () => {
  it("cannot be read by people without users.invite", async () => {
    const res = await as(db, claims("bob"), (q) => q("select id from public.invitations"));
    expect(res.rowCount).toBe(0);
  });

  it("can only be accepted by the verified invited email", async () => {
    const inv = await invite("alice", orgA, "unconfirmed@example.test", "employee");
    await expect(accept("mallory", inv)).rejects.toThrow(/not valid/);
    await expect(accept("unconfirmed", inv)).rejects.toThrow(/not valid/);
    const listed = await as(db, claims("unconfirmed"), (q) => q("select * from public.list_my_pending_invitations()"));
    expect(listed.rowCount).toBe(0);
  });

  it("cannot be accepted after revocation or expiry", async () => {
    const mallory = await invite("alice", orgA, "mallory@example.test", "employee");
    await as(db, claims("alice"), (q) => q("update public.invitations set status = 'revoked' where id = $1", [mallory]));
    await expect(accept("mallory", mallory)).rejects.toThrow(/not valid/);

    const again = await invite("alice", orgA, "mallory@example.test", "employee");
    await db.query("set session_replication_role = replica");
    await db.query("update public.invitations set expires_at = now() - interval '1 second' where id = $1", [again]);
    await db.query("set session_replication_role = origin");
    await expect(accept("mallory", again)).rejects.toThrow(/not valid/);
  });

  it("server sets expiry and inviter regardless of client input", async () => {
    const id = await invite("alice", orgA, "frank@example.test", "employee");
    const { rows } = await db.query("select invited_by, expires_at > now() + interval '6 days' as later from public.invitations where id = $1", [id]);
    expect(rows[0].invited_by).toBe(u.alice);
    expect(rows[0].later).toBe(true);
  });
});

describe("profiles", () => {
  it("lets users edit presentation fields of their own profile only", async () => {
    await as(db, claims("bob"), (q) => q("update public.profiles set display_name = 'Bobby' where id = $1", [u.bob]));
    const other = await as(db, claims("bob"), (q) =>
      q("update public.profiles set display_name = 'Hacked' where id = $1", [u.carol]),
    );
    expect(other.rowCount).toBe(0);
    await expect(
      as(db, claims("bob"), (q) => q("update public.profiles set status = 'active' where id = $1", [u.bob])),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects avatar paths outside the owner's folder", async () => {
    await expect(
      as(db, claims("bob"), (q) =>
        q("update public.profiles set avatar_path = $2 where id = $1", [u.bob, `${u.carol}/x.webp`]),
      ),
    ).rejects.toThrow(/profiles_avatar_path_owner/);
  });

  it("keeps legal name HR-managed and private details private", async () => {
    await expect(
      as(db, claims("bob"), (q) => q("update public.profile_private set legal_name = 'Robert' where user_id = $1", [u.bob])),
    ).rejects.toThrow(/managed by HR/);
    await as(db, claims("bob"), (q) => q("update public.profile_private set phone = '+44 7700 900123' where user_id = $1", [u.bob]));
    const dave = await as(db, claims("dave"), (q) => q("select phone from public.profile_private where user_id = $1", [u.bob]));
    expect(dave.rowCount).toBe(0);
    const alice = await as(db, claims("alice"), (q) => q("select phone from public.profile_private where user_id = $1", [u.bob]));
    expect(alice.rows[0].phone).toBe("+44 7700 900123");
  });
});

describe("avatars storage", () => {
  it("serves the current avatar only to people sharing an organization", async () => {
    const path = `${u.carol}/avatar-1.webp`;
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [path, u.carol]);
    await as(db, claims("carol"), (q) => q("update public.profiles set avatar_path = $2 where id = $1", [u.carol, path]));
    const colleague = await as(db, claims("bob"), (q) => q("select name from storage.objects where name = $1", [path]));
    expect(colleague.rowCount).toBe(1);
    const outsider = await as(db, claims("eve"), (q) => q("select name from storage.objects where name = $1", [path]));
    expect(outsider.rowCount).toBe(0);
  });

  it("does not let users write avatar objects directly", async () => {
    await expect(
      as(db, claims("bob"), (q) =>
        q("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${u.bob}/x.webp`, u.bob]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("audit log", () => {
  it("records role changes with actor and is visible only to audit.view holders", async () => {
    const asAlice = await as(db, claims("alice"), (q) =>
      q("select actor_user_id, action from public.audit_logs where target_table = 'membership_role_assignments' and organization_id = $1", [orgA]),
    );
    expect(asAlice.rowCount).toBeGreaterThan(0);
    expect(asAlice.rows.some((r) => r.actor_user_id === u.alice)).toBe(true);
    const asBob = await as(db, claims("bob"), (q) => q("select id from public.audit_logs"));
    expect(asBob.rowCount).toBe(0);
  });

  it("redacts private values but records that they changed", async () => {
    const { rows } = await db.query(
      "select new_values, changed_fields from public.audit_logs where target_table = 'profile_private' and target_id = $1 order by created_at desc limit 1",
      [u.bob],
    );
    expect(rows[0].changed_fields).toContain("phone");
    expect(rows[0].new_values).not.toHaveProperty("phone");
  });

  it("is immutable even for the database owner", async () => {
    await expect(db.query("update public.audit_logs set action = 'delete'")).rejects.toThrow(/immutable/);
    await expect(db.query("delete from public.audit_logs")).rejects.toThrow(/immutable/);
  });
});

describe("manager hierarchy", () => {
  it("rejects reporting cycles", async () => {
    await as(db, claims("alice"), (q) =>
      q("update public.organization_memberships set manager_membership_id = $2 where id = $1", [m.bob, m.carol]),
    );
    await expect(
      as(db, claims("alice"), (q) =>
        q("update public.organization_memberships set manager_membership_id = $2 where id = $1", [m.carol, m.bob]),
      ),
    ).rejects.toThrow(/reporting cycle/);
  });
});

describe("offboarding", () => {
  it("removes all access immediately while keeping history attributable", async () => {
    await as(db, claims("alice"), (q) =>
      q("update public.organization_memberships set status = 'deactivated' where id = $1", [m.bob]),
    );
    expect(await can("bob", orgA, "users.view")).toBe(false);
    expect(await can("bob", orgA, "expenses.create")).toBe(false);
    const colleagues = await as(db, claims("bob"), (q) => q("select id from public.profiles where id <> $1", [u.bob]));
    expect(colleagues.rowCount).toBe(0);
    const own = await as(db, claims("bob"), (q) => q("select status from public.organization_memberships where user_id = $1", [u.bob]));
    expect(own.rows[0].status).toBe("deactivated");
    // Colleagues still see Bob's name for historical attribution.
    const seen = await as(db, claims("carol"), (q) => q("select display_name from public.profiles where id = $1", [u.bob]));
    expect(seen.rows[0].display_name).toBe("Bobby");
    const meta = await db.query("select deactivated_by from public.organization_memberships where id = $1", [m.bob]);
    expect(meta.rows[0].deactivated_by).toBe(u.alice);
  });

  it("allows rehiring through a new invitation", async () => {
    const inv = await invite("alice", orgA, "bob@example.test", "employee");
    await accept("bob", inv);
    expect(await can("bob", orgA, "users.view")).toBe(true);
  });
});

describe("internal functions", () => {
  it("are not callable by signed-in users", async () => {
    await expect(as(db, claims("alice"), (q) => q("select public.seed_organization_roles($1)", [orgA]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(db, claims("alice"), (q) => q("select public.consume_rate_limit(repeat('a', 64), 5, 60)")),
    ).rejects.toThrow(/permission denied/);
  });

  it("rate limiter allows the service role and enforces the window", async () => {
    const results = await as(db, { role: "service_role" }, async (q) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) {
        out.push((await q("select public.consume_rate_limit(repeat('b', 64), 3, 3600) as ok")).rows[0].ok);
      }
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it("cannot be bypassed by an end user setting the trusted marker", async () => {
    await expect(
      as(db, claims("bob"), async (q) => {
        await q("select set_config('wbh.trusted_op', 'on', true)");
        return q(
          "insert into public.membership_role_assignments (organization_id, membership_id, role_id) values ($1, $2, $3)",
          [orgA, m.bob, role.super_admin],
        );
      }),
    ).rejects.toThrow(/row-level security|own role/);
  });
});
