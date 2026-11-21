# ADR 0001 — Stack: Next.js 16 + Supabase

Status: accepted (2026-10-20)

## Context
The spec requires a mobile-first PWA with auth, Postgres RLS, private storage, realtime chat
and background jobs, hosted on managed infrastructure.

## Decision
* Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, Zod 4.
* Supabase Auth, Postgres 17, Storage, Realtime. `@supabase/ssr` for cookie sessions.
* Node.js runtime everywhere (`sharp`, ExcelJS and ZIP streaming need it). Vercel is the
  reference host. Cloudflare Workers is **not** selected: `sharp` and Node streams would need
  replacements (validate before switching).
* UI components are hand-written, accessible primitives in `src/components/ui` following the
  shadcn/ui conventions (Tailwind + `cn()`), without the generator CLI, so the component
  code is fully owned and reviewed.

## Consequences
Server Actions are the mutation path; every action re-authorizes. The service-role key is
imported only from `src/lib/supabase/admin.ts`, which is `server-only`.
