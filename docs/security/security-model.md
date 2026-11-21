# Security model — Phase A

## Trust boundaries
| Component | Trusted with | Never trusted with |
|---|---|---|
| Browser | the user's own session cookie (HttpOnly, set by `@supabase/ssr`) | service-role key, other users' data beyond RLS |
| Next.js server | service-role key (server-only module), rate-limit salt | decisions without a DB check |
| Postgres | final authorization (RLS + triggers) | — |

## Controls implemented
| Threat | Control | Where | Tested |
|---|---|---|---|
| Cross-tenant read/write | RLS on every table, `is_org_member` / `has_permission` | `20261020000500_rls.sql` | `rls.test.ts` › tenant isolation |
| Cross-tenant linking | composite FKs `(id, organization_id)` | migrations 100–300 | `rls.test.ts` › cross-organization references |
| Privilege escalation | triggers: hold-every-permission rule, no self-assignment, protected Super Admin, deny overrides can't target Super Admins | `20261020000200_permissions.sql` | `rls.test.ts` › privilege escalation guards |
| Lockout | last active Super Admin can't be removed or deactivated | same | yes |
| IDOR via direct ids | every query is RLS-filtered; actions also scope by `organization_id` | services / actions | tenant isolation tests |
| Deactivated user keeps access | membership/profile status checked on every DB call; account banned when no active org remains | `has_permission`, `setMembershipStatus` | `rls.test.ts` › offboarding |
| Sensitive actions without MFA | org setting gates `is_sensitive` permissions to `aal2` sessions, inside `has_permission` | permissions migration | MFA test |
| Account enumeration | identical sign-in and reset responses | `server/actions/auth.ts` | manual |
| Brute force | Postgres-backed rate limits (account + IP) on sign-in/reset; Supabase Auth limits | `rate_limits` migration | `rls.test.ts` › rate limiter |
| Open redirect | `safeNextPath` on every `next` parameter | `lib/utils.ts` | unit + E2E |
| Malicious images | magic-byte detection, pixel limit, full decode + re-encode to WebP, metadata (EXIF/GPS) dropped | `lib/images/avatar.ts` | `avatar.test.ts` |
| Avatar leakage | private bucket; signed URLs issued with the viewer's session; only current avatar readable; no direct client writes | storage migration | `rls.test.ts` › avatars storage |
| XSS | React escaping, no `dangerouslySetInnerHTML` except the static theme script, CSP | `next.config.ts` | header E2E |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `next.config.ts` | header E2E |
| CSRF | Server Actions enforce same-origin (Next.js Origin check); sign-out is POST | framework / route | — |
| Audit tampering | append-only table, update/delete/truncate blocked by trigger even for the owner | audit migration | audit tests |
| Secrets in logs | structured logs carry error codes only; audit redacts private fields | `lib/errors.ts`, audit trigger | audit redaction test |
| Platform owner overreach | `platform_admins` grants org creation only; no tenant read access | RLS | platform owner test |

## Known gaps (tracked for Phase E unless noted)
* CSP uses `'unsafe-inline'` for scripts (Next.js inline runtime + theme script). Move to
  nonce-based CSP.
* Malware scanning for non-image uploads arrives with documents/attachments (Phase B). Images
  are neutralised by re-encoding.
* Rate limiter fails open if the database is unreachable (Supabase Auth limits still apply).
* MFA enforcement covers *sensitive* permissions; the org cannot yet require MFA for every
  member at sign-in.
* `auth.users` deletion is blocked by FK (`on delete restrict`) to preserve attribution;
  erasure requests need the anonymisation procedure planned for Phase E.

## Privacy notes
* Directory data (name, photo, title, team, work email if the org allows) is visible to
  colleagues in the same organization. Legal name and phone live in `profile_private`,
  visible only to the person and holders of `users.view.private`.
* Avatars are optional; initials are shown otherwise. Location and camera metadata are
  removed on upload.
* Audit entries for private details record *that* a field changed, never its value.
* Private messages (Phase B) will be readable only by participants. No role, including
  Super Admin and platform owner, can browse them.
