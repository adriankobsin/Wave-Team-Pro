-- Microsoft 365 project sync: each project with sync on gets a private Microsoft 365 group and a
-- Planner plan. Hub tasks, the project log and the project dates are mirrored into the plan, so
-- they show up in Planner, Microsoft To Do ("Assigned to me") and Outlook for every project member
-- except PAs and HR. Default OFF per company. All writes come from the server (service role).

create table public.m365_sync_settings (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  enabled boolean not null default false,
  -- Optional pilot list: when set, only these projects are synced (null = all eligible projects).
  project_ids uuid[],
  last_run_at timestamptz,
  last_report jsonb,
  updated_at timestamptz not null default now()
);
create trigger m365_sync_settings_updated_at before update on public.m365_sync_settings
  for each row execute function public.set_updated_at();

-- One row per synced project: the Microsoft ids and what the last run did.
create table public.project_m365_links (
  project_id uuid primary key,
  organization_id uuid not null,
  group_id text,
  plan_id text,
  bucket_ids jsonb not null default '{}'::jsonb,
  -- Pseudo-tasks kept up to date by the sync: { updates: {id, hash}, start: {id, hash}, end: {id, hash} }
  pinned jsonb not null default '{}'::jsonb,
  -- Microsoft user ids the sync added to the group (only these are ever removed again).
  managed_member_ids text[] not null default '{}',
  report jsonb,
  last_error text,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
create index project_m365_links_org_idx on public.project_m365_links (organization_id);

-- One row per Hub task that exists in Planner.
create table public.task_m365_links (
  task_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  planner_task_id text not null,
  etag text,
  content_hash text,
  -- Completion (0 / 50 / 100) both sides agreed on at the last sync; used to see who changed since.
  last_percent integer check (last_percent in (0, 50, 100)),
  synced_at timestamptz not null default now(),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete cascade
);
create index task_m365_links_project_idx on public.task_m365_links (project_id);

alter table public.m365_sync_settings enable row level security;
alter table public.project_m365_links enable row level security;
alter table public.task_m365_links enable row level security;

-- Admins read the settings and reports; the server (service role) writes everything.
grant select on public.m365_sync_settings to authenticated;
grant select on public.project_m365_links to authenticated;
create policy m365s_select on public.m365_sync_settings for select to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage'));
create policy m365l_select on public.project_m365_links for select to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage'));
-- task_m365_links: no policy and no grant for signed-in users; server only.
