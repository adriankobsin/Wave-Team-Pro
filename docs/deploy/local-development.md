# Local development

## Prerequisites
Node 20.9+ (22 recommended), pnpm 10, Docker (for the Supabase CLI stack), PostgreSQL 16+
client tools (for the integration test database).

## 1. Supabase locally
```bash
npx supabase start          # prints API URL, anon key, service_role key, Mailpit URL
npx supabase db reset       # migrations + supabase/seed.sql (synthetic demo data)
```
Put the printed values into `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
APP_BASE_URL=http://localhost:3000
RATE_LIMIT_SALT=<openssl rand -hex 32>
```
Emails (invites, password resets) land in Mailpit at http://127.0.0.1:54324.
`supabase/config.toml` already disables open sign-up, requires email confirmation, enables
TOTP MFA and points email templates at `supabase/templates/`.

## 2. Run
```bash
pnpm dev     # http://localhost:3000
```

## 3. Tests
* `pnpm test:unit` — no services needed.
* `pnpm test:integration` — starts its own Postgres cluster on port 54329 via
  `scripts/test-db.sh` (needs `initdb`/`pg_ctl` from PostgreSQL 16+), loads
  `tests/integration/support/supabase-shim.sql` (emulates `auth.uid()`, roles and
  storage tables) and every migration, then runs the RLS suite. To test against the CLI
  database instead: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:integration`
  after `supabase db reset` (the shim is skipped).
* `pnpm build && pnpm test:e2e` — smoke suite. With the CLI stack running and `.env.local`
  pointing at it: `E2E_SUPABASE=1 pnpm test:e2e` runs the invite → set password → join →
  selfie → deactivation journeys (reads Mailpit).

## Bootstrapping a real platform owner
Platform owners are rows in `public.platform_admins` and can only be added with SQL
(there is deliberately no UI). After the person has an account:
```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'you@company.com';
```
