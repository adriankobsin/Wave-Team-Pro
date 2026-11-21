-- Projects: a country, and moving a project to another company in the group.

alter table public.projects add column if not exists country char(2)
  check (country is null or country ~ '^[A-Z]{2}$');

-- Moves a project (with its tasks, members and assignments) to another company.
-- Recorded time, clock-ins, shifts and expenses belong to the original company's books, so a
-- project that has any is not moved: it is copied to the new company and the original is closed
-- (status "completed"), keeping its history where it was booked.
-- Caller must be able to edit the project and create projects in the target company.
create or replace function public.move_project(p_project uuid, p_target uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.projects;
  v_code text;
  v_manager uuid;
  v_history boolean;
  v_new uuid;
begin
  select * into p from public.projects where id = p_project for update;
  if p.id is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if p.organization_id = p_target then
    return jsonb_build_object('mode', 'none', 'project_id', p.id);
  end if;
  if not exists (select 1 from public.organizations where id = p_target and status = 'active') then
    raise exception 'That company is not available' using errcode = '22023';
  end if;
  if not (public.can_edit_project(p.id) and public.has_permission(p_target, 'projects.create')) then
    raise exception 'You need to manage projects in both companies' using errcode = '42501';
  end if;
  if p.code is not null and exists (select 1 from public.projects where organization_id = p_target and code = p.code) then
    raise exception 'Project code % is already used in that company. Change the code first.', p.code using errcode = '23505';
  end if;
  v_code := p.code;
  -- The same person as project manager in the new company, if they work there.
  select t.id into v_manager
  from public.organization_memberships s
  join public.organization_memberships t on t.user_id = s.user_id and t.organization_id = p_target and t.status = 'active'
  where s.id = p.manager_membership_id;

  v_history := exists (select 1 from public.timesheet_entries where project_id = p.id)
    or exists (select 1 from public.attendance_events where project_id = p.id)
    or exists (select 1 from public.expenses where project_id = p.id)
    or exists (select 1 from public.shifts where project_id = p.id)
    or exists (select 1 from public.timesheet_entries e join public.tasks t on t.id = e.task_id where t.project_id = p.id)
    or exists (select 1 from public.files f join public.tasks t on t.id = f.context_id where f.context_type = 'task' and t.project_id = p.id);

  perform set_config('wbh.trusted_op', 'on', true);

  if v_history then
    insert into public.projects (organization_id, code, name, description, site_label, country, manager_membership_id, status,
      start_date, end_date, budget_hours, budget_amount, budget_currency, cost_center, created_by)
    values (p_target, v_code, p.name, p.description, p.site_label, p.country, v_manager, p.status,
      p.start_date, p.end_date, p.budget_hours, p.budget_amount, p.budget_currency, p.cost_center, auth.uid())
    returning id into v_new;
    update public.projects set status = 'completed' where id = p.id and status in ('planning', 'active', 'on_hold');
    update public.organization_memberships set assigned_project_id = null where assigned_project_id = p.id;
    perform set_config('wbh.trusted_op', 'off', true);
    return jsonb_build_object('mode', 'copied', 'project_id', v_new);
  end if;

  -- One statement, so the company-matching foreign keys are checked once everything has moved.
  with
    pr as (
      update public.projects set organization_id = p_target, team_id = null, manager_membership_id = v_manager
      where id = p.id returning id
    ),
    tk as (update public.tasks set organization_id = p_target where project_id = p.id returning id),
    ta as (
      update public.task_assignees set organization_id = p_target
      where task_id in (select id from public.tasks where project_id = p.id) returning task_id
    ),
    tc as (
      update public.task_comments set organization_id = p_target
      where task_id in (select id from public.tasks where project_id = p.id) returning id
    ),
    old_members as (delete from public.project_members where project_id = p.id returning membership_id, role),
    new_members as (
      insert into public.project_members (project_id, organization_id, membership_id, role)
      select p.id, p_target, t.id, om.role
      from old_members om
      join public.organization_memberships s on s.id = om.membership_id
      join public.organization_memberships t on t.user_id = s.user_id and t.organization_id = p_target and t.status = 'active'
      on conflict do nothing
      returning membership_id
    ),
    am as (update public.organization_memberships set assigned_project_id = null where assigned_project_id = p.id returning id)
  select id into v_new from pr;

  perform set_config('wbh.trusted_op', 'off', true);
  return jsonb_build_object('mode', 'moved', 'project_id', p.id);
end;
$$;

revoke all on function public.move_project(uuid, uuid) from public, anon;
grant execute on function public.move_project(uuid, uuid) to authenticated;
