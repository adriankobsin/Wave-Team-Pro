import type { Client } from "pg";
import { as, createAuthUser } from "./db";

/**
 * Builds an isolated scenario: one platform owner, two organizations, and the named people
 * (with role keys) in organization A, plus an outsider super admin in organization B.
 * Every call uses a unique suffix so test files can share one database.
 */
export async function buildOrgs(
  db: Client,
  people: Record<string, string>, // name -> role key in org A
) {
  const tag = Math.random().toString(36).slice(2, 8);
  const u: Record<string, string> = {};
  const m: Record<string, string> = {};
  const email = (n: string) => `${n}-${tag}@example.test`;
  const claims = (n: string, aal: "aal1" | "aal2" = "aal1") => ({ sub: u[n], aal });

  u.owner = await createAuthUser(db, email("owner"));
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const mk = async (name: string, slug: string) =>
    (await as(db, claims("owner"), (q) => q("select public.create_organization($1, $2, 'GBP', 'Europe/London', 'GB') as id", [name, slug]))).rows[0].id as string;
  const orgA = await mk(`Org A ${tag}`, `a-${tag}`);
  const orgB = await mk(`Org B ${tag}`, `b-${tag}`);

  const join = async (name: string, org: string, inviter: string | null, roleKey: string) => {
    u[name] ??= await createAuthUser(db, email(name), { name: name[0].toUpperCase() + name.slice(1) });
    let inv: string;
    if (!inviter) {
      inv = (await as(db, claims("owner"), (q) => q("select public.create_initial_invitation($1, $2) as id", [org, email(name)]))).rows[0].id;
    } else {
      inv = (await as(db, claims(inviter), (q) =>
        q(`insert into public.invitations (organization_id, email, role_id, expires_at)
           values ($1, $2, (select id from public.roles where organization_id = $1 and key = $3), now()) returning id`, [org, email(name), roleKey]),
      )).rows[0].id;
    }
    m[name] = (await as(db, claims(name), (q) => q("select public.accept_invitation($1) as id", [inv]))).rows[0].id;
  };

  const entries = Object.entries(people);
  const [adminName] = entries.find(([, r]) => r === "super_admin") ?? ["admin", "super_admin"];
  await join(adminName, orgA, null, "super_admin");
  for (const [name, role] of entries) if (name !== adminName) await join(name, orgA, adminName, role);
  await join("outsider", orgB, null, "super_admin");

  const role = async (org: string, key: string) =>
    (await db.query("select id from public.roles where organization_id = $1 and key = $2", [org, key])).rows[0].id as string;

  return { u, m, orgA, orgB, claims, tag, role };
}
