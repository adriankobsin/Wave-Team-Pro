# Setting up Wave Team Pro for a new customer

Each customer gets their own copy of the platform: their own Supabase project (database, sign-in,
files) and their own Vercel project (the website). Nothing is shared between customers.

Time needed: about an hour, plus Microsoft 365 if they want it.

## 1. Supabase (database and sign-in)

1. Go to https://supabase.com/dashboard → **New project**. Name it after the customer
   (e.g. `acme-team`), choose the region nearest their staff, set a strong database password and
   keep it in your password manager.
2. **Authentication → Sign In / Providers → Email**: switch **off** "Allow new users to sign up",
   switch **on** "Confirm email".
3. **Authentication → URL Configuration**: Site URL = the customer's address (e.g.
   `https://team.acme.com`); add `https://team.acme.com/auth/confirm` under Redirect URLs.
4. **Authentication → Emails → Templates**: paste `supabase/templates/invite.html`,
   `recovery.html` and `confirmation.html` from this repository (Invite user, Reset password,
   Confirm signup). Change the product name in them if the customer uses their own.
5. **Authentication → Emails → SMTP Settings**: add a real email sender (e.g. Resend), so
   invitations aren't limited by Supabase's built-in sender.
6. Apply the database structure. Either:
   - with the Supabase CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`; or
   - in **SQL Editor**: paste and run every file in `supabase/migrations/`, in name order.
   Never run `supabase/seed.sql` or anything in `supabase/demo/` on a customer project.
7. **Project Settings → API Keys**: copy the Project URL, the anon / publishable key and the
   service role / secret key for step 2.

## 2. Vercel (the website)

1. https://vercel.com/new → import this repository (`Wave-Team-Pro`) → **Create a new project**
   for the customer (one Vercel project per customer, all from the same repository).
2. **Settings → Environment Variables** (Production), then **Redeploy**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role / secret key (mark **Sensitive**) |
| `APP_BASE_URL` | `https://team.acme.com` (no trailing slash) |
| `RATE_LIMIT_SALT` | random: `openssl rand -hex 32` |
| `CRON_SECRET` | random: `openssl rand -hex 32` |
| `NEXT_PUBLIC_PRODUCT_NAME` | optional, e.g. `Acme Team` (default `Wave Team Pro`) |
| `NEXT_PUBLIC_HUB_NAME` | optional, e.g. `Acme Hub` (default `Group Hub`) |
| `NEXT_PUBLIC_GROUP_NAME` | optional, e.g. `Acme` |
| `NEXT_PUBLIC_EXAMPLE_DOMAIN` / `NEXT_PUBLIC_EXAMPLE_COMPANY` | optional, e.g. `acme.com` / `Acme Ltd` |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | optional: Resend key and sender, e.g. `Acme Team <team@acme.com>` |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | optional: automatic receipt reading |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | optional: Microsoft 365 ([microsoft-365.md](microsoft-365.md)) |

3. **Settings → Domains**: add the customer's address and set the DNS record Vercel shows.
4. **Settings → Functions → Function Region**: pick the region nearest the Supabase project
   (the repository's `vercel.json` sets `sin1`, Singapore; change it there if most customers are
   elsewhere).

## 3. First sign-in

1. Create the platform owner's account: Supabase → **Authentication → Users → Add user → Create
   new user** (your or the customer's email, auto-confirm).
2. Supabase → **SQL Editor**, run (with that email):

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'owner@acme.com';
   ```

3. Sign in at the customer's address → **Platform** → create each company (name, web address,
   country, currency, time zone) and invite its first Super Admin.
4. The Super Admin signs in, uploads the company logo (Admin → Settings), and invites staff.
5. Companies that install AV, IT, security or lighting systems: Admin → Settings → **Modules** →
   tick **Systems integration toolkit**.

## 4. Checks before handing over

- [ ] Sign-in, password reset and an invitation email all arrive and open the right address.
- [ ] A basic employee account sees only its own pages (no Admin menu).
- [ ] Supabase → **Advisors** shows no security warnings.
- [ ] Supabase → **Database → Backups**: Point-in-Time Recovery on for paid customers.
