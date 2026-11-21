# Deploying Wave Team Pro

Reference topology: Next.js on Vercel (Node runtime), Supabase hosted project per
environment (development, staging, production). Use a separate Supabase project for each.

## 1. Supabase project
1. Create the project in the region closest to most staff and compatible with your data
   transfer assessment (e.g. `eu-west-2` London for UK/EU entities; `ap-southeast-1`
   Singapore for SE Asia). Record the decision in the privacy register.
2. **Auth → Providers → Email**: disable "Allow new users to sign up"; enable "Confirm email";
   enable "Secure password change".
3. **Auth → URL configuration**: Site URL = `https://<your-domain>`; Redirect URLs:
   `https://<your-domain>/auth/confirm`.
4. **Auth → Email templates**: paste `supabase/templates/invite.html`, `recovery.html` and
   `confirmation.html` (they link to `/auth/confirm?token_hash=…`).
5. **Auth → SMTP**: configure a real provider (Supabase's built-in sender is rate-limited
   and not for production).
6. **Auth → MFA**: enable TOTP.
7. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Never run `supabase/seed.sql` outside local development.
8. Check **Database → Advisors** (security + performance) is clean.
9. Storage: the migration creates the private `avatars` bucket. Confirm it shows as private.
10. Add the first platform owner with SQL (see local-development.md).

## 2. Vercel
Environment variables (Production and Preview separately):

| Name | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key — mark *Sensitive*, never expose to Preview builds from forks |
| `APP_BASE_URL` | `https://<your-domain>` |
| `RATE_LIMIT_SALT` | 32+ random bytes; required in production (app refuses to start without it) |

Build command `pnpm build`, Node 22. The app sets CSP, HSTS, frame and referrer headers in
`next.config.ts`.

## 3. Release checklist (every deploy)
- [ ] `pnpm check` green on the release commit; CI E2E smoke green
- [ ] `supabase db push --dry-run` reviewed; migrations are additive or have a rollback note
- [ ] Database advisors clean after migration
- [ ] Sign in as a non-admin test account and confirm admin pages show "no access"
- [ ] Spot-check audit log shows the deploy's test actions

## 4. Backups and restore
Enable Point-in-Time Recovery on the production project. Quarterly restore drill: restore to
a new project, point a staging deployment at it, sign in, verify directory and audit log.
Record the date and outcome in `docs/security/restore-drills.md`.

## 5. Rollback
* App: promote the previous Vercel deployment.
* Database: migrations are forward-only; ship a corrective migration. For data loss use PITR.
