# Phase A — completion checklist

Verified 2026-10-21 in a Linux workspace (Node 22, PostgreSQL 16, Chromium 1194).

## Delivered
- [x] Repository scaffold: Next.js 16, TS strict, Tailwind v4, Zod, Vitest, Playwright, Supabase CLI config
- [x] Architecture overview, ERD and ADRs (`docs/architecture/`)
- [x] Migrations: profiles, private profile, platform admins, organizations + settings, departments, teams, memberships, team memberships
- [x] Permission catalog (36 capabilities), roles, role permissions, scoped assignments, grant/deny overrides with expiry
- [x] `has_permission` / `my_permissions` evaluators with MFA (aal2) gating for sensitive permissions
- [x] Escalation guards, last-Super-Admin protection, manager-cycle prevention, immutable fields
- [x] Invitations (DB-set expiry and inviter), provisioning RPCs, invitee list/accept RPCs
- [x] Append-only audit log with redaction
- [x] Private avatars bucket + storage policy; DB-backed rate limiter
- [x] RLS on every table, default-deny grants, anon has no table access
- [x] Auth: invite-only, email-link verification (`/auth/confirm`), set/reset password, TOTP enrollment + step-up, sign out other devices
- [x] Onboarding (accept invitations, org picker), platform provisioning page
- [x] Workspace shell: desktop sidebar, mobile header + bottom nav, org switcher, dark/light, skip link, loading/error/404/offline states
- [x] Home dashboard (crew, manager, reports, admin counts, photo prompt)
- [x] People directory with search/filters; person page with avatar, teams, manager, local time
- [x] Profile: details, language, time zone, phone; selfie/camera or file with crop, zoom, rotate; remove photo
- [x] Admin: members, employment edit, team membership, role assignment (org/team scope), exceptions, deactivate/restore
- [x] Admin: invitations (send, resend, revoke, history), role builder, departments & teams, audit log viewer, org settings
- [x] i18n framework (English; Romanian scaffold), PWA manifest, service worker offline fallback
- [x] `.env.example`, local + production runbooks, security model, CI workflow, synthetic seed

## Verification
| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass, 0 warnings |
| `pnpm test:unit` | 34 tests pass |
| `pnpm test:integration` | 46 RLS/escalation tests pass against PostgreSQL 16 + shim |
| `pnpm build` | pass (26 routes) |
| `pnpm test:e2e` (smoke, desktop + mobile) | 22 pass |
| `E2E_SUPABASE=1 pnpm test:e2e` (journeys) | **not run here** — needs `supabase start` (Docker images unavailable in this workspace) |

## Not yet verified end-to-end
* Real Supabase Auth flows (invite email → set password → join, MFA enrollment, ban on
  deactivation) and real Storage uploads. Code paths are written and type-checked; the
  journeys spec covers them and must be run once against `supabase start` before Phase B.
* `supabase/seed.sql` was validated against the test database schema, not against GoTrue.
* Visual review of authenticated screens (only sign-in screens were screenshotted).

## Deferred by design
* Projects as a permission scope (enabled with the Projects module in Phase C).
* Notification emails for existing users who receive a new invitation (Phase B notifications).
