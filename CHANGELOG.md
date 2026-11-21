# Changelog

Newest first. For every release list what changed and any new database migration files
(they must be applied to every customer's Supabase project before the code goes live —
see HELP.md §6).

## 1.0.0 — 2026-11-21

First release of Wave Team Pro as an independent, white-label platform.

- Multi-company staff, time, leave, timesheets, tasks, projects, expenses, chat,
  announcements, documents and Company Communications, with the Group Hub view.
- Brand set per deployment with `NEXT_PUBLIC_*` variables; logos uploaded in the app.
- Systems integration toolkit as an optional module per company (off by default).
- Microsoft 365 (Outlook, SharePoint filing, Planner sync) hidden until configured.
- Help guide (HELP.md) for deployment, integrations and updates.

Migrations: all files in `supabase/migrations/` up to and including
`20261121000100_site_toolkit_option.sql`.
