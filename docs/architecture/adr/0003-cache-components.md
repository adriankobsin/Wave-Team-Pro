# ADR 0003 — Rendering: Cache Components disabled for V1

Status: accepted (2026-10-20). Revisit in Phase E.

`create-next-app@16` enables `cacheComponents` and `partialPrefetching`. Nearly every
workspace screen is per-user and permission-filtered, and a stale cached fragment of
permission-filtered data is a security bug, not just a UX glitch. With Cache Components on,
every session read must sit in `<Suspense>` or be explicitly opted out, and correct caching
of tenant data needs cache tags keyed by membership and invalidated on every role change.

Decision: run with classic request-time rendering (Cache Components off). All workspace
routes are dynamic; nothing tenant-specific is cached on the server. Loading states use
`loading.tsx` and `<Suspense>` where useful.

Revisit in Phase E with measurements; adopting it then means wrapping session reads in
Suspense boundaries and adding `cacheTag('membership:<id>')` invalidation on role changes.
