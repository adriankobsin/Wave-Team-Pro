-- Wave Team Pro — roles, granular permissions, scoped overrides, evaluation and
-- privilege-escalation guards.

create table public.permissions (
  key text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  module text not null,
  description text not null,
  allowed_scopes text[] not null check (
    allowed_scopes <@ array['organization', 'team', 'project', 'self']::text[]
    and cardinality(allowed_scopes) > 0
  ),
  -- Sensitive permissions require an aal2 (MFA) session when the organization enforces MFA.
  is_sensitive boolean not null default false,
  sort_order integer not null default 0
);

insert into public.permissions (key, module, description, allowed_scopes, is_sensitive, sort_order) values
  ('users.view',              'people',       'View the employee directory and profiles',            '{organization,team}', false, 10),
  ('users.invite',            'people',       'Invite employees and manage pending invitations',      '{organization}',      true,  11),
  ('users.edit',              'people',       'Edit employment details (department, manager, title)', '{organization,team}', true,  12),
  ('users.deactivate',        'people',       'Deactivate and reactivate employees',                  '{organization}',      true,  13),
  ('users.view.private',      'people',       'View legal name and private contact details',          '{organization}',      true,  14),
  ('roles.manage',            'admin',        'Create roles, assign roles and permission overrides',  '{organization}',      true,  20),
  ('org.settings.manage',     'admin',        'Edit organization settings and security policy',       '{organization}',      true,  21),
  ('org.structure.manage',    'admin',        'Manage departments, teams and team membership',        '{organization}',      false, 22),
  ('audit.view',              'admin',        'View the audit log',                                    '{organization}',      true,  23),
  ('announcements.publish',   'communication','Publish announcements',                                '{organization,team,project}', false, 30),
  ('chat.channel.create',     'communication','Create channels',                                      '{organization,team,project}', false, 31),
  ('chat.channel.moderate',   'communication','Moderate channel posts (not private messages)',        '{organization,team,project}', false, 32),
  ('documents.upload',        'documents',    'Upload documents',                                     '{organization,team,project}', false, 40),
  ('documents.read',          'documents',    'Read shared documents',                                '{organization,team,project}', false, 41),
  ('documents.manage',        'documents',    'Manage folders, permissions and versions',             '{organization,team,project}', false, 42),
  ('hr.documents.manage',     'documents',    'Manage confidential HR documents',                     '{organization}',      true,  43),
  ('projects.view',           'projects',     'View projects',                                        '{organization,team,project}', false, 50),
  ('projects.create',         'projects',     'Create projects',                                      '{organization,team}', false, 51),
  ('projects.edit',           'projects',     'Edit projects, milestones and budgets',                '{organization,team,project}', false, 52),
  ('tasks.assign',            'projects',     'Create and assign tasks',                              '{organization,team,project}', false, 53),
  ('attendance.view.self',    'workforce',    'View own attendance and clock in/out',                 '{self}',              false, 60),
  ('attendance.view.team',    'workforce',    'View and correct team attendance',                     '{organization,team}', false, 61),
  ('attendance.view.all',     'workforce',    'View all attendance',                                  '{organization}',      false, 62),
  ('timesheets.submit',       'workforce',    'Submit own timesheets',                                '{self}',              false, 63),
  ('timesheets.approve',      'workforce',    'Approve timesheets',                                   '{organization,team,project}', false, 64),
  ('leave.request',           'workforce',    'Request leave',                                        '{self}',              false, 65),
  ('leave.approve',           'workforce',    'Approve leave',                                        '{organization,team}', false, 66),
  ('expenses.create',         'finance',      'Capture receipts and submit expenses',                 '{self}',              false, 70),
  ('expenses.view.self',      'finance',      'View own expenses',                                    '{self}',              false, 71),
  ('expenses.view.team',      'finance',      'View team or project expenses',                        '{organization,team,project}', true, 72),
  ('expenses.view.all',       'finance',      'View all expenses in the organization',                '{organization}',      true,  73),
  ('expenses.approve',        'finance',      'Approve or reject expenses',                           '{organization,team,project}', true, 74),
  ('expenses.export',         'finance',      'Export expenses and receipts',                         '{organization}',      true,  75),
  ('reimbursements.manage',   'finance',      'Record reimbursements',                                '{organization}',      true,  76),
  ('reports.view',            'reports',      'View reports',                                         '{organization,team,project}', false, 80),
  ('reports.export',          'reports',      'Export reports',                                       '{organization,team,project}', true, 81);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  is_system boolean not null default false,
  is_protected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key),
  unique (id, organization_id)
);

create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create table public.role_permissions (
  organization_id uuid not null,
  role_id uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key),
  foreign key (role_id, organization_id) references public.roles (id, organization_id) on delete cascade
);

create index role_permissions_org_idx on public.role_permissions (organization_id);

create table public.membership_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  role_id uuid not null,
  scope_type text not null default 'organization' check (scope_type in ('organization', 'team', 'project')),
  scope_id uuid,
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((scope_type = 'organization') = (scope_id is null)),
  unique nulls not distinct (membership_id, role_id, scope_type, scope_id),
  foreign key (membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete cascade,
  foreign key (role_id, organization_id)
    references public.roles (id, organization_id) on delete restrict
);

create index role_assignments_membership_idx on public.membership_role_assignments (membership_id);
create index role_assignments_role_idx on public.membership_role_assignments (role_id);

create table public.scoped_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  effect text not null check (effect in ('grant', 'deny')),
  scope_type text not null default 'organization' check (scope_type in ('organization', 'team', 'project')),
  scope_id uuid,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  expires_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((scope_type = 'organization') = (scope_id is null)),
  unique nulls not distinct (membership_id, permission_key, scope_type, scope_id),
  foreign key (membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete cascade
);

create index overrides_membership_idx on public.scoped_permission_overrides (membership_id);

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------

create or replace function public.session_is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.has_permission(
  p_org uuid,
  p_permission text,
  p_scope_type text default 'organization',
  p_scope_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mid uuid;
  v_sensitive boolean;
  v_mfa boolean;
begin
  if auth.uid() is null or p_org is null or p_permission is null then
    return false;
  end if;

  v_mid := public.my_membership_id(p_org);
  if v_mid is null then
    return false;
  end if;

  select p.is_sensitive into v_sensitive from public.permissions p where p.key = p_permission;
  if not found then
    return false;
  end if;

  if v_sensitive then
    select s.mfa_required_for_sensitive into v_mfa
    from public.organization_settings s where s.organization_id = p_org;
    if coalesce(v_mfa, false) and not public.session_is_aal2() then
      return false;
    end if;
  end if;

  -- Deny always wins. An organization-wide deny blocks every scope.
  if exists (
    select 1 from public.scoped_permission_overrides o
    where o.membership_id = v_mid
      and o.permission_key = p_permission
      and o.effect = 'deny'
      and (o.expires_at is null or o.expires_at > now())
      and (o.scope_type = 'organization' or (o.scope_type = p_scope_type and o.scope_id = p_scope_id))
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.membership_role_assignments a
    join public.role_permissions rp on rp.role_id = a.role_id
    where a.membership_id = v_mid
      and rp.permission_key = p_permission
      and (a.scope_type = 'organization' or (a.scope_type = p_scope_type and a.scope_id = p_scope_id))
  ) then
    return true;
  end if;

  return exists (
    select 1 from public.scoped_permission_overrides o
    where o.membership_id = v_mid
      and o.permission_key = p_permission
      and o.effect = 'grant'
      and (o.expires_at is null or o.expires_at > now())
      and (o.scope_type = 'organization' or (o.scope_type = p_scope_type and o.scope_id = p_scope_id))
  );
end;
$$;

-- Effective permission set for the caller in one organization (for UI gating).
create or replace function public.my_permissions(p_org uuid)
returns table (permission_key text, scope_type text, scope_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mid uuid;
  v_mfa boolean;
  v_aal2 boolean;
begin
  v_mid := public.my_membership_id(p_org);
  if v_mid is null then
    return;
  end if;
  select coalesce(s.mfa_required_for_sensitive, false) into v_mfa
  from public.organization_settings s where s.organization_id = p_org;
  v_aal2 := public.session_is_aal2();

  return query
  with grants as (
    select rp.permission_key, a.scope_type, a.scope_id
    from public.membership_role_assignments a
    join public.role_permissions rp on rp.role_id = a.role_id
    where a.membership_id = v_mid
    union
    select o.permission_key, o.scope_type, o.scope_id
    from public.scoped_permission_overrides o
    where o.membership_id = v_mid and o.effect = 'grant'
      and (o.expires_at is null or o.expires_at > now())
  ),
  denies as (
    select o.permission_key, o.scope_type, o.scope_id
    from public.scoped_permission_overrides o
    where o.membership_id = v_mid and o.effect = 'deny'
      and (o.expires_at is null or o.expires_at > now())
  )
  select g.permission_key, g.scope_type, g.scope_id
  from grants g
  join public.permissions p on p.key = g.permission_key
  where not (p.is_sensitive and coalesce(v_mfa, false) and not v_aal2)
    and not exists (
      select 1 from denies d
      where d.permission_key = g.permission_key
        and (d.scope_type = 'organization'
             or (d.scope_type = g.scope_type and d.scope_id is not distinct from g.scope_id))
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Scope validation (team scope now; project scope is enabled with Phase C projects)
-- ---------------------------------------------------------------------------

create or replace function public.validate_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scope_type = 'team' then
    if not exists (select 1 from public.teams t where t.id = new.scope_id and t.organization_id = new.organization_id) then
      raise exception 'Team scope must reference a team in the same organization' using errcode = '23503';
    end if;
  elsif new.scope_type = 'project' then
    raise exception 'Project-scoped grants become available with the Projects module' using errcode = '0A000';
  end if;
  return new;
end;
$$;

create trigger role_assignments_validate_scope before insert or update on public.membership_role_assignments
  for each row execute function public.validate_scope();
create trigger overrides_validate_scope before insert or update on public.scoped_permission_overrides
  for each row execute function public.validate_scope();

-- Permissions may only be granted at scopes they support.
create or replace function public.validate_override_permission_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scopes text[];
begin
  select p.allowed_scopes into v_scopes from public.permissions p where p.key = new.permission_key;
  if new.scope_type <> 'organization' and not (new.scope_type = any (v_scopes)) then
    raise exception 'Permission % cannot be scoped to %', new.permission_key, new.scope_type using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger overrides_validate_permission_scope before insert or update on public.scoped_permission_overrides
  for each row execute function public.validate_override_permission_scope();

-- ---------------------------------------------------------------------------
-- Escalation guards
-- ---------------------------------------------------------------------------

create or replace function public.membership_user(p_membership uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.organization_memberships where id = p_membership;
$$;

-- Raises unless the caller holds every permission in p_role at the given scope.
create or replace function public.assert_holds_role_permissions(
  p_org uuid, p_role uuid, p_scope_type text, p_scope_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in
    select rp.permission_key from public.role_permissions rp where rp.role_id = p_role
  loop
    if not public.has_permission(p_org, v_key, p_scope_type, p_scope_id) then
      raise exception 'You cannot grant or revoke a role containing "%" because you do not hold it', v_key
        using errcode = '42501';
    end if;
  end loop;
end;
$$;

create or replace function public.guard_role_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);
  if public.membership_user(r.membership_id) = auth.uid() then
    raise exception 'You cannot change your own role assignments' using errcode = '42501';
  end if;
  if not public.has_permission(r.organization_id, 'roles.manage') then
    raise exception 'roles.manage permission required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    perform public.assert_holds_role_permissions(old.organization_id, old.role_id, old.scope_type, old.scope_id);
  end if;
  perform public.assert_holds_role_permissions(r.organization_id, r.role_id, r.scope_type, r.scope_id);
  if tg_op = 'INSERT' then
    new.granted_by := auth.uid();
  end if;
  return coalesce(new, old);
end;
$$;

create trigger role_assignments_guard before insert or update or delete on public.membership_role_assignments
  for each row execute function public.guard_role_assignment();

create or replace function public.is_protected_role(p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_protected from public.roles where id = p_role), false);
$$;

create or replace function public.guard_role_permission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);
  if public.is_protected_role(r.role_id) then
    raise exception 'The Super Admin role cannot be modified' using errcode = '42501';
  end if;
  if not public.has_permission(r.organization_id, 'roles.manage') then
    raise exception 'roles.manage permission required' using errcode = '42501';
  end if;
  if not public.has_permission(r.organization_id, r.permission_key) then
    raise exception 'You cannot add or remove "%" because you do not hold it', r.permission_key
      using errcode = '42501';
  end if;
  -- Editing a role you hold would let you widen your own access indirectly.
  if exists (
    select 1 from public.membership_role_assignments a
    where a.role_id = r.role_id and a.membership_id = public.my_membership_id(r.organization_id)
  ) then
    raise exception 'You cannot edit a role that is assigned to you' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function public.guard_role_permission();

create or replace function public.guard_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.is_protected then
    raise exception 'The Super Admin role cannot be modified' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.is_system := false;
    new.is_protected := false;
  elsif tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.key <> old.key
       or new.is_system <> old.is_system or new.is_protected <> old.is_protected then
      raise exception 'Role key, organization and system flags are immutable' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function public.guard_role();

create or replace function public.membership_has_protected_role(p_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membership_role_assignments a
    join public.roles r on r.id = a.role_id
    where a.membership_id = p_membership and r.is_protected and a.scope_type = 'organization'
  );
$$;

create or replace function public.guard_override()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);
  if public.membership_user(r.membership_id) = auth.uid() then
    raise exception 'You cannot change your own permission overrides' using errcode = '42501';
  end if;
  if not public.has_permission(r.organization_id, 'roles.manage') then
    raise exception 'roles.manage permission required' using errcode = '42501';
  end if;
  if not public.has_permission(r.organization_id, r.permission_key, r.scope_type, r.scope_id) then
    raise exception 'You cannot override "%" because you do not hold it', r.permission_key
      using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and r.effect = 'deny' and public.membership_has_protected_role(r.membership_id) then
    raise exception 'Super Admins cannot be restricted with deny overrides' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return coalesce(new, old);
end;
$$;

create trigger overrides_guard before insert or update or delete on public.scoped_permission_overrides
  for each row execute function public.guard_override();

-- ---------------------------------------------------------------------------
-- An organization must always keep at least one active Super Admin.
-- ---------------------------------------------------------------------------

create or replace function public.assert_org_has_super_admin(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Organizations still being provisioned (no members yet) are exempt.
  if not exists (select 1 from public.organization_memberships where organization_id = p_org) then
    return;
  end if;
  if not exists (
    select 1
    from public.membership_role_assignments a
    join public.roles r on r.id = a.role_id and r.is_protected
    join public.organization_memberships m on m.id = a.membership_id and m.status = 'active'
    join public.profiles p on p.id = m.user_id and p.status = 'active'
    where a.organization_id = p_org and a.scope_type = 'organization'
  ) then
    raise exception 'An organization must keep at least one active Super Admin' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_super_admin_after_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations where id = old.organization_id) then
    perform public.assert_org_has_super_admin(old.organization_id);
  end if;
  return null;
end;
$$;

create trigger role_assignments_keep_super_admin after delete or update on public.membership_role_assignments
  for each row execute function public.enforce_super_admin_after_assignment_change();

create or replace function public.enforce_super_admin_after_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and old.status = 'active' then
    perform public.assert_org_has_super_admin(new.organization_id);
  end if;
  return null;
end;
$$;

create trigger memberships_keep_super_admin after update of status on public.organization_memberships
  for each row execute function public.enforce_super_admin_after_membership_change();

create or replace function public.enforce_super_admin_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.status = 'deactivated' and old.status = 'active' then
    for v_org in
      select organization_id from public.organization_memberships where user_id = new.id and status = 'active'
    loop
      perform public.assert_org_has_super_admin(v_org);
    end loop;
  end if;
  return null;
end;
$$;

create trigger profiles_keep_super_admin after update of status on public.profiles
  for each row execute function public.enforce_super_admin_after_profile_change();

-- ---------------------------------------------------------------------------
-- Role templates, seeded into every new organization.
-- ---------------------------------------------------------------------------

create or replace function public.seed_organization_roles(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role uuid;
  t record;
begin
  perform set_config('wbh.trusted_op', 'on', true);
  for t in
    select * from (values
      ('super_admin', 'Super Admin', 'Full control of this organization. Cannot be edited.', true,
        (select array_agg(key) from public.permissions)),
      ('va_admin', 'Admin / Virtual Assistant', 'Invites people, maintains structure and announcements.', false,
        array['users.view','users.invite','users.edit','roles.manage','org.structure.manage','announcements.publish',
              'chat.channel.create','documents.upload','documents.read','projects.view',
              'attendance.view.self','timesheets.submit','leave.request','expenses.create','expenses.view.self']),
      ('hr_manager', 'HR Manager', 'People records, leave approvals, confidential HR files.', false,
        array['users.view','users.invite','users.edit','users.deactivate','users.view.private',
              'hr.documents.manage','attendance.view.all','leave.approve','announcements.publish',
              'documents.upload','documents.read','reports.view','attendance.view.self','timesheets.submit',
              'leave.request','expenses.create','expenses.view.self']),
      ('project_manager', 'Project Manager', 'Runs projects, assigns tasks, approves project time.', false,
        array['users.view','projects.view','projects.create','projects.edit','tasks.assign',
              'timesheets.approve','chat.channel.create','documents.upload','documents.read','documents.manage',
              'reports.view','attendance.view.self','timesheets.submit','leave.request','expenses.create',
              'expenses.view.self','expenses.view.team']),
      ('team_leader', 'Team Leader', 'Leads a team: attendance, leave and timesheet approvals.', false,
        array['users.view','projects.view','tasks.assign','attendance.view.team','timesheets.approve',
              'leave.approve','chat.channel.create','documents.upload','documents.read','attendance.view.self',
              'timesheets.submit','leave.request','expenses.create','expenses.view.self']),
      ('bookkeeper', 'Bookkeeper', 'Reviews and exports expenses, records reimbursements.', false,
        array['users.view','expenses.view.all','expenses.approve','expenses.export','reimbursements.manage',
              'reports.view','reports.export','documents.read','attendance.view.self','timesheets.submit',
              'leave.request','expenses.create','expenses.view.self']),
      ('employee', 'Employee', 'Standard staff self-service.', false,
        array['users.view','projects.view','documents.upload','documents.read','attendance.view.self',
              'timesheets.submit','leave.request','expenses.create','expenses.view.self']),
      ('auditor', 'Read-only Auditor', 'Read-only access to reports, expenses and the audit log.', false,
        array['users.view','audit.view','reports.view','expenses.view.all','projects.view','documents.read'])
    ) as v(key, name, description, is_protected, perms)
  loop
    insert into public.roles (organization_id, key, name, description, is_system, is_protected)
    values (p_org, t.key, t.name, t.description, true, t.is_protected)
    on conflict (organization_id, key) do nothing
    returning id into v_role;
    if v_role is not null then
      insert into public.role_permissions (organization_id, role_id, permission_key)
      select p_org, v_role, unnest(t.perms)
      on conflict do nothing;
    end if;
  end loop;
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;
