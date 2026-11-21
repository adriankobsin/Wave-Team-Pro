import { Client } from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:54329/wbh_test";

export type Claims = { sub?: string; role?: string; aal?: "aal1" | "aal2"; email?: string };

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Runs `fn` exactly like PostgREST would for a request: inside a transaction, as the
 * `authenticated` (or `anon`) database role with the JWT claims set locally.
 * The transaction is committed so the effect is visible to later steps; pass
 * `{ rollback: true }` to discard it.
 */
export async function as<T>(
  db: Client,
  claims: Claims | null,
  fn: (q: Client["query"]) => Promise<T>,
  opts: { rollback?: boolean } = {},
): Promise<T> {
  await db.query("begin");
  try {
    if (claims === null) {
      await db.query("set local role anon");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    } else {
      const role = claims.role ?? "authenticated";
      await db.query(`set local role ${role === "service_role" ? "service_role" : "authenticated"}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role, aal: "aal1", ...claims }),
      ]);
    }
    const result = await fn(db.query.bind(db) as Client["query"]);
    await db.query(opts.rollback ? "rollback" : "commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

/** Creates an auth user the way GoTrue would (the profile trigger fires). */
export async function createAuthUser(
  db: Client,
  email: string,
  opts: { confirmed?: boolean; name?: string } = {},
): Promise<string> {
  const { rows } = await db.query(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, $3) returning id`,
    [email, opts.confirmed === false ? null : new Date(), { display_name: opts.name ?? email.split("@")[0] }],
  );
  return rows[0].id as string;
}
