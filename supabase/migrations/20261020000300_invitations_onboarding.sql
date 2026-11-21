-- Wave Team Pro — invitations, organization provisioning, membership guards,
-- private profile guard.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  email extensions.citext not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  role_id uuid not null,
  department_id uuid,
  team_id uuid,
  manager_membership_id uuid,
  job_title text check (job_title is null or char_length(job_title) <= 120),
  employee_number text check (employee_number is null or char_length(employee_number) <= 40),
  start_date date,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.profiles (id),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (role_id, organization_id) references public.roles (id, organization_id) on delete restrict,
  foreign key (department_id, organization_id)
    references public.departments (id, organization_id) on delete set null (department_id),
  foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete set null (team_id),
  foreign key (manager_membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete set null (manager_membership_id)
);

create unique index invitations_one_pending_per_email
  on public.invitations (organization_id, email) where status = 'pending';
create index invitations_email_idx on public.invitations (email, status);
create index invitations_org_status_idx on public.invitations (organization_id, status, created_at desc);

create trigger invitations_updated_at before update on public.invitations
  for each row execute function public.set_updated_at();

create or replace function public.guard_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_days integer;
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if not public.has_permission(new.organization_id, 'users.invite') then
    raise exception 'users.invite permission required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- Inviting someone with a role you could not grant yourself is escalation.
    perform public.assert_holds_role_permissions(new.organization_id, new.role_id, 'organization', null);
    select invitation_expiry_days into v_days from public.organization_settings
      where organization_id = new.organization_id;
    new.status := 'pending';
    new.invited_by := auth.uid();
    new.accepted_by := null;
    new.accepted_at := null;
    new.revoked_at := null;
    new.expires_at := now() + make_interval(days => coalesce(v_days, 7));
  else
    -- Admins may only revoke a pending invitation, or extend its expiry ("resend").
    if old.status <> 'pending' then
      raise exception 'Only pending invitations can be changed' using errcode = '42501';
    end if;
    if new.organization_id <> old.organization_id or new.email <> old.email
       or new.role_id <> old.role_id or new.invited_by is distinct from old.invited_by
       or new.accepted_by is not null or new.accepted_at is not null
       or new.status not in ('pending', 'revoked') then
      raise exception 'Invitation fields cannot be changed; revoke and invite again' using errcode = '42501';
    end if;
    if new.status = 'revoked' then
      new.revoked_at := now();
    end if;
    if new.expires_at <> old.expires_at then
      select invitation_expiry_days into v_days from public.organization_settings
        where organization_id = new.organization_id;
      new.expires_at := now() + make_interval(days => coalesce(v_days, 7));
    end if;
  end if;
  return new;
end;
$$;

create trigger invitations_guard before insert or update on public.invitations
  for each row execute function public.guard_invitation();

-- ---------------------------------------------------------------------------
-- Membership guard: immutable keys, permission checks per field group.
-- ---------------------------------------------------------------------------

create or replace function public.guard_membership_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if new.organization_id <> old.organization_id or new.user_id <> old.user_id
     or new.created_at <> old.created_at then
    raise exception 'Membership organization and user are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.user_id = auth.uid() then
      raise exception 'You cannot change your own employment status' using errcode = '42501';
    end if;
    if not public.has_permission(new.organization_id, 'users.deactivate') then
      raise exception 'users.deactivate permission required' using errcode = '42501';
    end if;
    if new.status = 'deactivated' then
      new.deactivated_at := now();
      new.deactivated_by := auth.uid();
    elsif new.status = 'active' then
      new.deactivated_at := null;
      new.deactivated_by := null;
    end if;
  elsif new.deactivated_at is distinct from old.deactivated_at
     or new.deactivated_by is distinct from old.deactivated_by then
    raise exception 'Deactivation metadata is system-managed' using errcode = '42501';
  end if;
  if (new.employee_number, new.department_id, new.job_title, new.manager_membership_id, new.start_date)
     is distinct from
     (old.employee_number, old.department_id, old.job_title, old.manager_membership_id, old.start_date) then
    if not public.has_permission(new.organization_id, 'users.edit') then
      raise exception 'users.edit permission required' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_guard before update on public.organization_memberships
  for each row execute function public.guard_membership_update();

-- Prevent manager cycles (A manages B manages A).
create or replace function public.prevent_manager_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.manager_membership_id is null then
    return new;
  end if;
  if exists (
    with recursive chain(id, depth) as (
      select new.manager_membership_id, 1
      union all
      select m.manager_membership_id, c.depth + 1
      from public.organization_memberships m
      join chain c on m.id = c.id
      where m.manager_membership_id is not null and c.depth < 50
    )
    select 1 from chain where id = new.id
  ) then
    raise exception 'Manager assignment would create a reporting cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger memberships_no_manager_cycle before insert or update of manager_membership_id
  on public.organization_memberships
  for each row execute function public.prevent_manager_cycle();

-- Legal name is admin-managed; phone is self-service.
create or replace function public.can_manage_private_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_user
      and public.has_permission(m.organization_id, 'users.edit')
      and public.has_permission(m.organization_id, 'users.view.private')
  );
$$;

create or replace function public.can_view_private_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid() or exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_user
      and public.has_permission(m.organization_id, 'users.view.private')
  );
$$;

create or replace function public.guard_profile_private()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if new.user_id <> old.user_id then
    raise exception 'user_id is immutable' using errcode = '42501';
  end if;
  if new.legal_name is distinct from old.legal_name and not public.can_manage_private_profile(new.user_id) then
    raise exception 'Legal name is managed by HR' using errcode = '42501';
  end if;
  if new.phone is distinct from old.phone
     and new.user_id <> auth.uid() and not public.can_manage_private_profile(new.user_id) then
    raise exception 'Not allowed to change this phone number' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profile_private_guard before update on public.profile_private
  for each row execute function public.guard_profile_private();

-- Profile status and email are system-managed (service role / auth sync).
create or replace function public.guard_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if new.id <> old.id or new.status <> old.status or new.email_display is distinct from old.email_display
     or new.deactivated_at is distinct from old.deactivated_at or new.created_at <> old.created_at then
    raise exception 'This profile field is system-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------------
-- Provisioning (platform owner) — creates the organization shell only.
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_base_currency text,
  p_timezone text,
  p_country text,
  p_legal_entity_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform owners can create organizations' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  insert into public.organizations (name, slug, base_currency, timezone, country, legal_entity_code, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), upper(p_base_currency), p_timezone, upper(p_country),
          nullif(btrim(coalesce(p_legal_entity_code, '')), ''), auth.uid())
  returning id into v_org;
  insert into public.organization_settings (organization_id) values (v_org);
  perform public.seed_organization_roles(v_org);
  perform set_config('wbh.trusted_op', 'off', true);
  return v_org;
end;
$$;

-- The platform owner invites the first Super Admin of an organization that has no members.
create or replace function public.create_initial_invitation(p_org uuid, p_email text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role uuid;
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform owners can bootstrap organizations' using errcode = '42501';
  end if;
  if exists (select 1 from public.organization_memberships where organization_id = p_org) then
    raise exception 'Organization already has members; its admins send invitations' using errcode = '42501';
  end if;
  select id into v_role from public.roles where organization_id = p_org and key = 'super_admin';
  if v_role is null then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.invitations set status = 'revoked', revoked_at = now()
    where organization_id = p_org and email = lower(btrim(p_email)) and status = 'pending';
  insert into public.invitations (organization_id, email, display_name, role_id, invited_by, expires_at)
  values (p_org, lower(btrim(p_email)), nullif(btrim(coalesce(p_display_name, '')), ''), v_role, auth.uid(),
          now() + interval '7 days')
  returning id into v_id;
  perform set_config('wbh.trusted_op', 'off', true);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitee side
-- ---------------------------------------------------------------------------

create or replace function public.my_verified_email()
returns extensions.citext
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::extensions.citext from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create or replace function public.list_my_pending_invitations()
returns table (
  invitation_id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  role_name text,
  job_title text,
  invited_by_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, o.id, o.name, o.slug::text, r.name, i.job_title, p.display_name, i.expires_at
  from public.invitations i
  join public.organizations o on o.id = i.organization_id and o.status = 'active'
  join public.roles r on r.id = i.role_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and public.my_verified_email() is not null
    and i.email = public.my_verified_email()
  order by i.created_at;
$$;

create or replace function public.accept_invitation(p_invitation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations%rowtype;
  v_membership uuid;
  v_existing public.organization_memberships%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to accept invitations' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    raise exception 'Your account is deactivated' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations where id = p_invitation for update;
  if not found or v_inv.status <> 'pending' or v_inv.expires_at <= now()
     or public.my_verified_email() is null or v_inv.email <> public.my_verified_email() then
    -- Same message for every failure so invitation ids cannot be probed.
    raise exception 'Invitation is not valid for this account' using errcode = '42501';
  end if;

  perform set_config('wbh.trusted_op', 'on', true);

  select * into v_existing from public.organization_memberships
    where organization_id = v_inv.organization_id and user_id = v_uid;
  if found then
    if v_existing.status = 'active' then
      raise exception 'You are already a member of this organization' using errcode = '23505';
    end if;
    update public.organization_memberships
      set status = 'active', deactivated_at = null, deactivated_by = null,
          department_id = coalesce(v_inv.department_id, department_id),
          job_title = coalesce(v_inv.job_title, job_title),
          manager_membership_id = coalesce(v_inv.manager_membership_id, manager_membership_id),
          employee_number = coalesce(v_inv.employee_number, employee_number),
          start_date = coalesce(v_inv.start_date, start_date)
      where id = v_existing.id;
    v_membership := v_existing.id;
  else
    insert into public.organization_memberships
      (organization_id, user_id, employee_number, department_id, job_title, manager_membership_id, start_date)
    values (v_inv.organization_id, v_uid, v_inv.employee_number, v_inv.department_id, v_inv.job_title,
            v_inv.manager_membership_id, coalesce(v_inv.start_date, current_date))
    returning id into v_membership;
  end if;

  insert into public.membership_role_assignments (organization_id, membership_id, role_id, scope_type, granted_by)
  values (v_inv.organization_id, v_membership, v_inv.role_id, 'organization', v_inv.invited_by)
  on conflict do nothing;

  if v_inv.team_id is not null then
    insert into public.team_memberships (organization_id, team_id, membership_id)
    values (v_inv.organization_id, v_inv.team_id, v_membership)
    on conflict do nothing;
  end if;

  if v_inv.display_name is not null then
    update public.profiles set display_name = v_inv.display_name
      where id = v_uid and display_name = split_part(coalesce(email_display::text, ''), '@', 1);
  end if;

  update public.invitations
    set status = 'accepted', accepted_by = v_uid, accepted_at = now()
    where id = v_inv.id;

  perform set_config('wbh.trusted_op', 'off', true);
  return v_membership;
end;
$$;

-- Organizations the caller belongs to (for the org switcher), including inactive ones so
-- the UI can explain why access ended.
create or replace function public.my_organizations()
returns table (
  organization_id uuid,
  name text,
  slug text,
  membership_id uuid,
  membership_status text,
  organization_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug::text, m.id, m.status, o.status
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
  order by o.name;
$$;
