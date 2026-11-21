-- Wave Team Pro — append-only audit log for sensitive changes.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  actor_user_id uuid,
  actor_role text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  target_table text not null,
  target_id uuid,
  old_values jsonb,
  new_values jsonb,
  changed_fields text[],
  created_at timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_table, target_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit records are immutable' using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_mutation();

-- Generic row audit. TG_ARGV[0] = column holding the target id (default 'id');
-- remaining arguments = columns to redact (never written to the log).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_id_col text := coalesce(tg_argv[0], 'id');
  v_redact text[] := coalesce(tg_argv[1:], array[]::text[]);
  v_col text;
  v_changed text[];
  v_org uuid;
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  v_old := v_old - 'updated_at';
  v_new := v_new - 'updated_at';

  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return null; -- nothing meaningful changed
    end if;
  end if;

  v_row := coalesce(v_new, v_old);
  -- Redact after diffing so the log records *that* a sensitive field changed, not its value.
  foreach v_col in array v_redact loop
    v_old := v_old - v_col;
    v_new := v_new - v_col;
  end loop;
  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  elsif v_row ? 'organization_id' then
    v_org := (v_row ->> 'organization_id')::uuid;
  end if;

  insert into public.audit_logs
    (organization_id, actor_user_id, actor_role, action, target_table, target_id,
     old_values, new_values, changed_fields)
  values
    (v_org, auth.uid(), coalesce(v_claims ->> 'role', current_user::text), lower(tg_op), tg_table_name,
     (v_row ->> v_id_col)::uuid, v_old, v_new, v_changed);
  return null;
end;
$$;

create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function public.audit_row_change();
create trigger audit_organization_settings after insert or update or delete on public.organization_settings
  for each row execute function public.audit_row_change('organization_id');
create trigger audit_memberships after insert or update or delete on public.organization_memberships
  for each row execute function public.audit_row_change();
create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function public.audit_row_change();
create trigger audit_teams after insert or update or delete on public.teams
  for each row execute function public.audit_row_change();
create trigger audit_team_memberships after insert or update or delete on public.team_memberships
  for each row execute function public.audit_row_change();
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function public.audit_row_change();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_change('role_id');
create trigger audit_role_assignments after insert or update or delete on public.membership_role_assignments
  for each row execute function public.audit_row_change();
create trigger audit_overrides after insert or update or delete on public.scoped_permission_overrides
  for each row execute function public.audit_row_change();
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function public.audit_row_change();
-- Profile changes: identity fields only; avatar paths are noise and not sensitive history.
create trigger audit_profiles after update of display_name, status on public.profiles
  for each row execute function public.audit_row_change('id', 'avatar_path', 'avatar_thumb_path');
-- Private details: record that they changed, never the values.
create trigger audit_profile_private after update on public.profile_private
  for each row execute function public.audit_row_change('user_id', 'legal_name', 'phone');
