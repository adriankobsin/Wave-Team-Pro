# ADR 0002 — Tenancy and permission evaluation in Postgres

Status: accepted (2026-10-20)

## Decision
Authorization lives in the database. `public.has_permission()` is the one evaluator, used by
RLS policies, storage policies and the application. Server code calls it via RPC for UX
decisions (show/hide), but the RLS policy on the underlying table is what actually allows or
blocks a read or write.

Tenant isolation uses `organization_id` on every tenant row plus composite foreign keys
`(id, organization_id)` so rows can only reference rows in the same organization.

Privilege-escalation rules are triggers rather than application code so they also apply to
direct PostgREST calls made with a stolen or crafted user token.

## Alternatives considered
* JWT custom claims with role lists — rejected: stale until token refresh, so deactivation
  and role removal would not be immediate.
* Application-only checks — rejected by the spec ("UI hiding is not security").
