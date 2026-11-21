-- Basic staff accounts: work is assigned by management. Without "work.self_manage" a person
-- can't pick projects (clock-in uses the project management assigned), can't add or change
-- timesheet lines (clocked time fills them), and can't create tasks or assign themselves;
-- they can still move their assigned tasks along (status) and comment.

select set_config('wbh.trusted_op', 'on', true);

insert into public.permissions (key, module, description, allowed_scopes, is_sensitive, sort_order) values
  ('work.self_manage', 'workforce', 'Choose own projects, add own timesheet lines, create own tasks', '{organization}', false, 66)
on conflict (key) do nothing;

-- Management roles get it (super admins get every permission).
insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'work.self_manage'
from public.roles r
where r.key in ('super_admin', 'va_admin', 'hr_manager', 'project_manager', 'team_leader', 'director')
on conflict do nothing;

-- The project a person is currently working on, set by management.
alter table public.organization_memberships add column assigned_project_id uuid;
alter table public.organization_memberships add constraint memberships_assigned_project_fk
  foreign key (assigned_project_id, organization_id) references public.projects (id, organization_id) on delete set null (assigned_project_id);

-- Which project a clock-in counts against when the person doesn't choose: today's shift with a
-- project (covering now, or starting within the next 2 hours), else the assigned project.
create or replace function public.assigned_project_of(p_membership uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select s.project_id from public.shifts s
      where s.membership_id = p_membership and s.project_id is not null
        and s.starts_at <= now() + interval '2 hours' and s.ends_at >= now()
      order by s.starts_at limit 1),
    (select m.assigned_project_id from public.organization_memberships m where m.id = p_membership));
$$;

revoke all on function public.assigned_project_of(uuid) from public, anon, authenticated;

-- What the caller will be clocked in to, per company (for the clock panel).
create or replace function public.my_assignments()
returns table (organization_id uuid, membership_id uuid, project_id uuid, project_name text, can_choose boolean)
language sql stable security definer set search_path = ''
as $$
  select m.organization_id, m.id, p.id, coalesce(p.code || ' · ', '') || p.name,
         public.has_permission(m.organization_id, 'work.self_manage')
  from public.organization_memberships m
  left join public.projects p on p.id = public.assigned_project_of(m.id)
  where m.user_id = auth.uid() and m.status = 'active';
$$;

revoke all on function public.my_assignments() from public, anon;
grant execute on function public.my_assignments() to authenticated;

-- Clock: people without work.self_manage can't pick a project; theirs is filled in.
create or replace function public.clock_on(p_org uuid, p_kind text, p_project uuid default null, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_mid uuid := public.my_membership_id(p_org);
  v_state text;
  v_at timestamptz := clock_timestamp();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_project uuid := p_project;
  o record;
begin
  if v_mid is null or not public.has_permission(p_org, 'attendance.view.self') then
    raise exception 'You do not have attendance access here' using errcode = '42501';
  end if;
  if p_kind not in ('clock_in', 'clock_out', 'break_start', 'break_end', 'switch') then
    raise exception 'Unknown clock action' using errcode = '22023';
  end if;
  if p_project is not null then
    if not public.has_permission(p_org, 'work.self_manage') then
      raise exception 'Your project is assigned by your manager' using errcode = '42501';
    end if;
    if not exists (select 1 from public.projects where id = p_project and organization_id = p_org and status in ('planning', 'active', 'on_hold'))
       or not public.can_view_project(p_project) then
      raise exception 'You cannot clock in to that project' using errcode = '42501';
    end if;
  elsif p_kind in ('clock_in', 'switch') then
    v_project := public.assigned_project_of(v_mid);
  end if;
  if p_kind = 'switch' and v_project is null then
    raise exception 'Choose the project to switch to' using errcode = '22023';
  end if;
  v_state := public.attendance_state(v_mid);
  if (p_kind = 'clock_in' and v_state <> 'out')
     or (p_kind = 'clock_out' and v_state = 'out')
     or (p_kind = 'break_start' and v_state <> 'in')
     or (p_kind = 'break_end' and v_state <> 'break')
     or (p_kind = 'switch' and v_state = 'out') then
    raise exception 'That action does not match your current status (%). Refresh and try again.', v_state using errcode = '22023';
  end if;

  perform set_config('wbh.trusted_op', 'on', true);

  if p_kind = 'clock_in' then
    for o in
      select m.id, m.organization_id, public.attendance_state(m.id) st
      from public.organization_memberships m
      where m.user_id = auth.uid() and m.status = 'active' and m.id <> v_mid
    loop
      if o.st = 'break' then
        insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
        values (o.organization_id, o.id, 'break_end', v_at - interval '2 milliseconds', 'app', auth.uid());
      end if;
      if o.st in ('in', 'break') then
        insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, created_by)
        values (o.organization_id, o.id, 'clock_out', v_at - interval '1 millisecond', 'app', 'Clocked in at another company', auth.uid());
      end if;
    end loop;
  end if;

  if p_kind = 'switch' then
    if v_state = 'break' then
      insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
      values (p_org, v_mid, 'break_end', v_at - interval '2 milliseconds', 'app', auth.uid());
    end if;
    insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, created_by)
    values (p_org, v_mid, 'clock_out', v_at - interval '1 millisecond', 'app', 'Switched project', auth.uid());
    insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, project_id, created_by)
    values (p_org, v_mid, 'clock_in', v_at, 'app', v_note, v_project, auth.uid());
  else
    if p_kind = 'clock_out' and v_state = 'break' then
      insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
      values (p_org, v_mid, 'break_end', v_at - interval '1 millisecond', 'app', auth.uid());
    end if;
    insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, project_id, created_by)
    values (p_org, v_mid, p_kind, v_at, 'app', v_note, case when p_kind = 'clock_in' then v_project end, auth.uid());
  end if;

  perform set_config('wbh.trusted_op', 'off', true);
  return v_at;
end;
$$;

-- Timesheet lines: rows from clock-ins are written only by the server; typing lines needs work.self_manage.
create or replace function public.guard_timesheet_entry()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  t record;
  r record;
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);
  if not public.timesheet_owner_editable(r.timesheet_id) then
    raise exception 'This timesheet is submitted or approved and can no longer be changed' using errcode = '42501';
  end if;
  if (tg_op <> 'INSERT' and old.from_clock) or (tg_op <> 'DELETE' and new.from_clock) then
    raise exception 'Clocked time comes from your clock-ins; ask for an attendance correction to change it' using errcode = '42501';
  end if;
  if not public.has_permission(r.organization_id, 'work.self_manage') then
    raise exception 'Your timesheet is filled from your clock-ins; ask your manager to add time' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    select * into t from public.timesheets where id = new.timesheet_id;
    if new.work_date < t.week_start or new.work_date > t.week_start + 6 then
      raise exception 'The date must fall inside this timesheet week' using errcode = '22023';
    end if;
    if new.project_id is not null and not public.can_view_project(new.project_id) then
      raise exception 'You cannot log time to that project' using errcode = '42501';
    end if;
    if new.task_id is not null and not exists (select 1 from public.tasks x where x.id = new.task_id
        and x.project_id is not distinct from new.project_id) then
      raise exception 'The task must belong to the selected project' using errcode = '22023';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- Tasks: creating tasks and changing anything but the status needs work.self_manage (own tasks)
-- or tasks.assign. Assignees can always move a task along.
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
    if not (v_manage or public.has_permission(new.organization_id, 'work.self_manage')) then
      raise exception 'Tasks are created and assigned by your manager' using errcode = '42501';
    end if;
    if new.project_id is not null and not (v_manage or public.is_project_member(new.project_id)) then
      raise exception 'You can only add tasks to projects you work on' using errcode = '42501';
    end if;
  else
    if new.organization_id <> old.organization_id or new.created_by <> old.created_by then
      raise exception 'Task identity fields are immutable' using errcode = '42501';
    end if;
    if new.project_id is distinct from old.project_id and not public.can_assign_in(new.organization_id, new.project_id) then
      raise exception 'tasks.assign permission required to move tasks between projects' using errcode = '42501';
    end if;
    if not v_manage and not (old.created_by = auth.uid() and public.has_permission(new.organization_id, 'work.self_manage'))
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
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  select * into t from public.tasks where id = coalesce(new.task_id, old.task_id);
  v_manage := public.can_assign_in(t.organization_id, t.project_id)
              or (t.created_by = auth.uid() and public.has_permission(t.organization_id, 'work.self_manage'));
  if tg_op = 'INSERT' then
    if public.user_membership_id(t.organization_id, new.user_id) is null then
      raise exception 'That person is not an active member' using errcode = '23503';
    end if;
    if not v_manage then
      raise exception 'Tasks are assigned by your manager' using errcode = '42501';
    end if;
    new.assigned_by := auth.uid();
    return new;
  end if;
  if not v_manage then
    raise exception 'Tasks are assigned by your manager' using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_timesheet_entry() from public, anon, authenticated;
revoke all on function public.guard_task() from public, anon, authenticated;
revoke all on function public.guard_task_assignee() from public, anon, authenticated;

-- New organizations: the same role templates, with basic Employees (no project list, no uploads).
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
              'attendance.view.self','timesheets.submit','leave.request','expenses.create','expenses.view.self','work.self_manage']),
      ('hr_manager', 'HR Manager', 'People records, leave approvals, confidential HR files.', false,
        array['users.view','users.invite','users.edit','users.deactivate','users.view.private',
              'hr.documents.manage','attendance.view.all','leave.approve','announcements.publish',
              'documents.upload','documents.read','reports.view','attendance.view.self','timesheets.submit',
              'leave.request','expenses.create','expenses.view.self','work.self_manage']),
      ('project_manager', 'Project Manager', 'Runs projects, assigns tasks, approves project time.', false,
        array['users.view','projects.view','projects.create','projects.edit','tasks.assign',
              'timesheets.approve','chat.channel.create','documents.upload','documents.read','documents.manage',
              'reports.view','attendance.view.self','timesheets.submit','leave.request','expenses.create',
              'expenses.view.self','expenses.view.team','work.self_manage']),
      ('team_leader', 'Team Leader', 'Leads a team: attendance, leave and timesheet approvals.', false,
        array['users.view','projects.view','tasks.assign','attendance.view.team','timesheets.approve',
              'leave.approve','chat.channel.create','documents.upload','documents.read','attendance.view.self',
              'timesheets.submit','leave.request','expenses.create','expenses.view.self','work.self_manage']),
      ('bookkeeper', 'Bookkeeper', 'Reviews and exports expenses, records reimbursements.', false,
        array['users.view','expenses.view.all','expenses.approve','expenses.export','reimbursements.manage',
              'reports.view','reports.export','documents.read','attendance.view.self','timesheets.submit',
              'leave.request','expenses.create','expenses.view.self']),
      ('employee', 'Employee', 'Basic staff account: clock in, timesheets, leave, expenses. Work is assigned by management.', false,
        array['users.view','documents.read','attendance.view.self',
              'timesheets.submit','leave.request','expenses.create','expenses.view.self'])
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

revoke all on function public.seed_organization_roles(uuid) from public, anon, authenticated;

update public.roles set description = 'Basic staff account: clock in, timesheets, leave, expenses. Work is assigned by management.'
where key = 'employee';

select set_config('wbh.trusted_op', 'off', true);
