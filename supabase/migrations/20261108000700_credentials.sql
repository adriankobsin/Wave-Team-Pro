-- Passwords: usernames, passwords and login details for devices, servers, networks and online
-- platforms, per company and optionally per project.
--
-- * Passwords are encrypted with Supabase Vault; the table only holds the vault id.
-- * Only people with `credentials.view` can see the list; a password is shown only through
--   reveal_credential(), and every reveal is logged.
-- * Adding, changing and removing needs `credentials.manage`.
-- * Both permissions are sensitive: if the company requires two-step verification for protected
--   permissions, they only work after verifying.
-- * Nothing here is included in exports, the project pack or QR pages.

insert into public.permissions (key, module, description, allowed_scopes, is_sensitive, sort_order) values
  ('credentials.view', 'projects', 'See stored logins and reveal passwords', '{organization}', true, 58),
  ('credentials.manage', 'projects', 'Add, change and remove stored logins and passwords', '{organization}', true, 59)
on conflict (key) do nothing;

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, k.key
from public.roles r cross join (values ('credentials.view'), ('credentials.manage')) as k(key)
where r.key in ('super_admin', 'project_manager')
on conflict do nothing;

-- New companies: Super Admin gets every permission when seeded; the Project Manager gets these too.
create or replace function public.grant_credentials_to_project_manager()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_system and new.key = 'project_manager' then
    perform set_config('wbh.trusted_op', 'on', true);
    insert into public.role_permissions (organization_id, role_id, permission_key)
    values (new.organization_id, new.id, 'credentials.view'), (new.organization_id, new.id, 'credentials.manage')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.grant_credentials_to_project_manager() from public, anon, authenticated;
create or replace trigger roles_grant_credentials after insert on public.roles
  for each row execute function public.grant_credentials_to_project_manager();

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid references public.projects (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null default 'device' check (category in ('device', 'network', 'server', 'platform', 'wifi', 'account', 'other')),
  address text check (address is null or char_length(address) <= 300),
  username text check (username is null or char_length(username) <= 200),
  secret_id uuid,
  device_id uuid references public.site_devices (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index credentials_org_idx on public.credentials (organization_id, project_id) where archived_at is null;

create table public.credential_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  credential_id uuid not null references public.credentials (id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'password_changed', 'revealed', 'removed')),
  user_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index credential_events_idx on public.credential_events (credential_id, at desc);

alter table public.credentials enable row level security;
alter table public.credential_events enable row level security;

/** Can the signed-in person see this credential (permission + access to its project)? */
create or replace function public.can_view_credential(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_permission(p_org, 'credentials.view')
    and (p_project is null or public.can_view_project(p_project));
$$;
revoke all on function public.can_view_credential(uuid, uuid) from public, anon;
grant execute on function public.can_view_credential(uuid, uuid) to authenticated;

create policy credentials_select on public.credentials for select to authenticated
  using (public.can_view_credential(organization_id, project_id));
create policy credential_events_select on public.credential_events for select to authenticated
  using (public.has_permission(organization_id, 'credentials.manage'));
-- No insert / update / delete policies: changes go through the functions below.
grant select on public.credentials, public.credential_events to authenticated;

/** Adds (p_id null) or changes a stored login. p_set_password false leaves the password alone. */
create or replace function public.save_credential(
  p_id uuid, p_org uuid, p_project uuid, p_name text, p_category text, p_address text, p_username text,
  p_set_password boolean, p_password text, p_device uuid, p_notes text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.credentials;
  v_id uuid;
  v_secret uuid;
begin
  if auth.uid() is null or not public.has_permission(p_org, 'credentials.manage') then
    raise exception 'You can''t change stored passwords' using errcode = '42501';
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.organization_id = p_org and public.can_view_project(p.id)
  ) then
    raise exception 'Project not found' using errcode = '22023';
  end if;
  if p_device is not null and not exists (
    select 1 from public.site_devices d where d.id = p_device and d.organization_id = p_org and d.project_id is not distinct from p_project
  ) then
    raise exception 'That device is not in this project' using errcode = '22023';
  end if;
  if char_length(coalesce(p_password, '')) > 1000 then
    raise exception 'That password is too long' using errcode = '22023';
  end if;

  if p_id is null then
    if p_set_password and coalesce(p_password, '') <> '' then
      v_secret := vault.create_secret(p_password);
    end if;
    insert into public.credentials (organization_id, project_id, name, category, address, username, secret_id, device_id, notes, created_by, updated_by)
    values (p_org, p_project, btrim(p_name), p_category, nullif(btrim(p_address), ''), nullif(p_username, ''), v_secret, p_device, nullif(btrim(p_notes), ''), auth.uid(), auth.uid())
    returning id into v_id;
    insert into public.credential_events (organization_id, credential_id, action, user_id) values (p_org, v_id, 'created', auth.uid());
    return v_id;
  end if;

  select * into v_row from public.credentials c where c.id = p_id and c.organization_id = p_org and c.archived_at is null for update;
  if not found or (v_row.project_id is not null and not public.can_view_project(v_row.project_id)) then
    raise exception 'Login not found' using errcode = '22023';
  end if;
  v_secret := v_row.secret_id;
  if p_set_password then
    if v_secret is not null then
      perform vault.update_secret(v_secret, coalesce(p_password, ''));
      if coalesce(p_password, '') = '' then v_secret := null; end if;
    elsif coalesce(p_password, '') <> '' then
      v_secret := vault.create_secret(p_password);
    end if;
  end if;
  update public.credentials set
    project_id = p_project, name = btrim(p_name), category = p_category, address = nullif(btrim(p_address), ''),
    username = nullif(p_username, ''), secret_id = v_secret, device_id = p_device, notes = nullif(btrim(p_notes), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  insert into public.credential_events (organization_id, credential_id, action, user_id)
  values (p_org, p_id, case when p_set_password then 'password_changed' else 'updated' end, auth.uid());
  return p_id;
end;
$$;
revoke all on function public.save_credential(uuid, uuid, uuid, text, text, text, text, boolean, text, uuid, text) from public, anon;
grant execute on function public.save_credential(uuid, uuid, uuid, text, text, text, text, boolean, text, uuid, text) to authenticated;

/** Returns the password (empty when none is stored) and logs who looked. */
create or replace function public.reveal_credential(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.credentials;
  v_secret text;
begin
  select * into v_row from public.credentials c where c.id = p_id and c.archived_at is null;
  if not found or auth.uid() is null or not public.can_view_credential(v_row.organization_id, v_row.project_id) then
    raise exception 'You can''t see this password' using errcode = '42501';
  end if;
  if v_row.secret_id is not null then
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.id = v_row.secret_id;
  end if;
  insert into public.credential_events (organization_id, credential_id, action, user_id) values (v_row.organization_id, p_id, 'revealed', auth.uid());
  return coalesce(v_secret, '');
end;
$$;
revoke all on function public.reveal_credential(uuid) from public, anon;
grant execute on function public.reveal_credential(uuid) to authenticated;

/** Removes a stored login: hidden from lists and its password wiped from the vault. */
create or replace function public.remove_credential(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.credentials;
begin
  select * into v_row from public.credentials c where c.id = p_id and c.archived_at is null for update;
  if not found or auth.uid() is null or not public.has_permission(v_row.organization_id, 'credentials.manage')
     or (v_row.project_id is not null and not public.can_view_project(v_row.project_id)) then
    raise exception 'You can''t remove this login' using errcode = '42501';
  end if;
  if v_row.secret_id is not null then
    perform vault.update_secret(v_row.secret_id, '');
  end if;
  update public.credentials set archived_at = now(), secret_id = null, updated_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.credential_events (organization_id, credential_id, action, user_id) values (v_row.organization_id, p_id, 'removed', auth.uid());
end;
$$;
revoke all on function public.remove_credential(uuid) from public, anon;
grant execute on function public.remove_credential(uuid) to authenticated;
