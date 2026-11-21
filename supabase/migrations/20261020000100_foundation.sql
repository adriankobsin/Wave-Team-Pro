-- Wave Team Pro — Phase A foundation
-- Profiles, platform admins, organizations, settings, departments, teams, memberships.
-- Every tenant row carries organization_id; child rows reference parents with composite
-- (id, organization_id) foreign keys so cross-organization links are impossible.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Utility functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

create or replace function public.validate_timezone_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null and not public.is_valid_timezone(new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

-- A database operation is "trusted" when it is executed by the service role (server-only
-- key), by a migration/superuser, or inside one of our SECURITY DEFINER procedures that
-- has explicitly marked the transaction. End-user roles (anon, authenticated) are never
-- trusted, even if they set the marker themselves, because current_user is checked.
create or replace function public.is_trusted_db_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or (
      current_user not in ('anon', 'authenticated')
      and (
        auth.uid() is null
        or coalesce(current_setting('wbh.trusted_op', true), '') = 'on'
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user). Deleting an auth user is blocked so historical
-- attribution survives; offboarding deactivates instead.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  avatar_path text,
  avatar_thumb_path text,
  email_display extensions.citext,
  locale text not null default 'en' check (locale in ('en', 'ro')),
  timezone text not null default 'UTC',
  status text not null default 'active' check (status in ('active', 'deactivated')),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_avatar_path_owner check (
    avatar_path is null or avatar_path like id::text || '/%'
  ),
  constraint profiles_avatar_thumb_owner check (
    avatar_thumb_path is null or avatar_thumb_path like id::text || '/%'
  )
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profiles_timezone before insert or update of timezone on public.profiles
  for each row execute function public.validate_timezone_column();

-- Sensitive personal details kept apart from the directory-visible profile.
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()\-]{6,24}$'),
  updated_at timestamptz not null default now()
);

create trigger profile_private_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();

-- Create a profile whenever Supabase Auth creates a user (invite or admin create).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := split_part(coalesce(new.email, 'New user'), '@', 1);
  end if;
  insert into public.profiles (id, display_name, email_display)
  values (new.id, left(v_name, 80), new.email)
  on conflict (id) do nothing;
  insert into public.profile_private (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email_display = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- Platform owners may provision organizations; this grants no tenant data access.
create table public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Organizations (legal entities)
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  legal_entity_code text check (legal_entity_code is null or char_length(legal_entity_code) <= 64),
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'UTC',
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger organizations_timezone before insert or update of timezone on public.organizations
  for each row execute function public.validate_timezone_column();

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  mfa_required_for_sensitive boolean not null default false,
  invitation_expiry_days integer not null default 7 check (invitation_expiry_days between 1 and 30),
  directory_show_email boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger organization_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Departments and teams
-- ---------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  code text check (code is null or char_length(code) <= 32),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

create trigger departments_updated_at before update on public.departments
  for each row execute function public.set_updated_at();

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  department_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  foreign key (department_id, organization_id)
    references public.departments (id, organization_id) on delete set null (department_id)
);

create index teams_department_idx on public.teams (department_id);
create trigger teams_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Memberships: a user's employment record inside one organization.
-- ---------------------------------------------------------------------------

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  employee_number text check (employee_number is null or char_length(employee_number) <= 40),
  department_id uuid,
  job_title text check (job_title is null or char_length(job_title) <= 120),
  manager_membership_id uuid,
  start_date date,
  status text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (id, organization_id),
  unique (organization_id, employee_number),
  check (manager_membership_id is null or manager_membership_id <> id),
  foreign key (department_id, organization_id)
    references public.departments (id, organization_id) on delete set null (department_id),
  foreign key (manager_membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete set null (manager_membership_id)
);

create index memberships_user_idx on public.organization_memberships (user_id, status);
create index memberships_org_status_idx on public.organization_memberships (organization_id, status);
create index memberships_department_idx on public.organization_memberships (department_id);
create index memberships_manager_idx on public.organization_memberships (manager_membership_id);

create trigger organization_memberships_updated_at before update on public.organization_memberships
  for each row execute function public.set_updated_at();

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_id uuid not null,
  membership_id uuid not null,
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  unique (team_id, membership_id),
  foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade,
  foreign key (membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete cascade
);

create index team_memberships_membership_idx on public.team_memberships (membership_id);

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER so RLS policies can call them without recursion)
-- ---------------------------------------------------------------------------

create or replace function public.my_membership_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_org
    and m.user_id = auth.uid()
    and m.status = 'active'
    and p.status = 'active'
    and o.status = 'active';
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_membership_id(p_org) is not null;
$$;

-- True when the caller and p_user are both active members of at least one organization.
create or replace function public.shares_active_org(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    join public.profiles me on me.id = mine.user_id
    join public.organizations o on o.id = mine.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and me.status = 'active'
      and o.status = 'active'
      and theirs.user_id = p_user
      and theirs.status in ('active', 'suspended', 'deactivated')
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    join public.profiles p on p.id = pa.user_id
    where pa.user_id = auth.uid() and p.status = 'active'
  );
$$;
