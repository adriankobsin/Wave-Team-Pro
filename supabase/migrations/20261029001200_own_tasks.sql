-- Employees add their own tasks (personal, or on a project they work on), assigned to themselves.
-- Managers, PAs and super admins see every task in the company, including those.

insert into public.permissions (key, module, description, allowed_scopes, is_sensitive, sort_order) values
  ('tasks.view.all', 'projects', 'See every task in the company, including staff''s own tasks', '{organization}', false, 57)
on conflict (key) do nothing;

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'tasks.view.all'
from public.roles r
where r.key in ('super_admin', 'va_admin', 'director', 'hr_manager', 'project_manager', 'team_leader')
on conflict do nothing;

-- New companies: the same roles get it when they're seeded.
create or replace function public.grant_task_view_to_management_role()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_system and new.key in ('va_admin', 'director', 'hr_manager', 'project_manager', 'team_leader') then
    perform set_config('wbh.trusted_op', 'on', true);
    insert into public.role_permissions (organization_id, role_id, permission_key)
    values (new.organization_id, new.id, 'tasks.view.all')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.grant_task_view_to_management_role() from public, anon, authenticated;
create or replace trigger roles_grant_task_view after insert on public.roles
  for each row execute function public.grant_task_view_to_management_role();

create or replace function public.can_view_task_row(p_org uuid, p_id uuid, p_project uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_org_member(p_org) and (
    p_creator = auth.uid()
    or public.is_task_assignee(p_id)
    or public.has_permission(p_org, 'tasks.view.all')
    or (p_project is not null and public.can_view_project(p_project))
    or (p_project is null and public.has_permission(p_org, 'tasks.assign'))
  );
$$;

create or replace function public.guard_task()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_manage boolean;
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  v_manage := public.can_assign_in(new.organization_id, new.project_id);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    -- Anyone may add their own task; on a project only if they work on it.
    if new.project_id is not null and not (v_manage or public.is_project_member(new.project_id)) then
      raise exception 'You can only add tasks to projects you work on' using errcode = '42501';
    end if;
  else
    if new.organization_id <> old.organization_id or new.created_by <> old.created_by then
      raise exception 'Task identity fields are immutable' using errcode = '42501';
    end if;
    if new.project_id is distinct from old.project_id and not (
      public.can_assign_in(new.organization_id, new.project_id)
      or (old.created_by = auth.uid() and (new.project_id is null or public.is_project_member(new.project_id)))
    ) then
      raise exception 'You can only move your own tasks to projects you work on' using errcode = '42501';
    end if;
    -- People edit their own tasks; tasks set by management are changed by management.
    if not v_manage and old.created_by <> auth.uid()
       and (new.title is distinct from old.title or new.description is distinct from old.description
            or new.priority is distinct from old.priority or new.due_date is distinct from old.due_date
            or new.estimate_hours is distinct from old.estimate_hours or new.archived_at is distinct from old.archived_at) then
      raise exception 'You can update the status; other changes are made by your manager' using errcode = '42501';
    end if;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.guard_task_assignee()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  t record;
  v_manage boolean;
  r record := coalesce(new, old);
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  select * into t from public.tasks where id = r.task_id;
  v_manage := public.can_assign_in(t.organization_id, t.project_id)
              or (t.created_by = auth.uid() and public.has_permission(t.organization_id, 'work.self_manage'));
  -- Your own task, assigned to yourself.
  if not v_manage and not (t.created_by = auth.uid() and r.user_id = auth.uid()) then
    raise exception 'Tasks are assigned by your manager' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if public.user_membership_id(t.organization_id, new.user_id) is null then
      raise exception 'That person is not an active member' using errcode = '23503';
    end if;
    new.assigned_by := auth.uid();
    return new;
  end if;
  return old;
end;
$$;

revoke all on function public.guard_task() from public, anon, authenticated;
revoke all on function public.guard_task_assignee() from public, anon, authenticated;
