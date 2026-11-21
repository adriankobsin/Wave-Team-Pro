-- Wave Team Pro — Phase C: projects, tasks, schedules (shifts), attendance,
-- timesheets and leave. Approvals are performed through SECURITY DEFINER procedures that
-- check supervision rights, prevent self-approval and record who decided and when.

-- ---------------------------------------------------------------------------
-- Supervision: who may see and approve another person's time records.
-- ---------------------------------------------------------------------------

-- True when the caller may act on p_membership's records using p_perm: organization-wide
-- grant, direct manager, or a team-scoped grant for one of the person's teams.
-- Never true for the caller's own membership.
create or replace function public.can_supervise(p_org uuid, p_perm text, p_membership uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := public.my_membership_id(p_org);
begin
  if v_me is null or p_membership is null or p_membership = v_me then
    return false;
  end if;
  if not exists (select 1 from public.organization_memberships where id = p_membership and organization_id = p_org) then
    return false;
  end if;
  if public.has_permission(p_org, p_perm) then
    return true;
  end if;
  if exists (select 1 from public.organization_memberships m where m.id = p_membership and m.manager_membership_id = v_me)
     and exists (select 1 from public.my_permissions(p_org) x where x.permission_key = p_perm) then
    return true;
  end if;
  return exists (
    select 1 from public.team_memberships tm
    where tm.membership_id = p_membership
      and public.has_permission(p_org, p_perm, 'team', tm.team_id)
  );
end;
$$;

create or replace function public.membership_org(p_membership uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select organization_id from public.organization_memberships where id = p_membership; $$;

create or replace function public.membership_user_of(p_membership uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select user_id from public.organization_memberships where id = p_membership; $$;

-- Own records, supervised team records, or organization-wide attendance access.
create or replace function public.can_view_time_of(p_org uuid, p_membership uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_membership = public.my_membership_id(p_org)
      or public.has_permission(p_org, 'attendance.view.all')
      or public.can_supervise(p_org, 'attendance.view.team', p_membership)
      or public.can_supervise(p_org, 'timesheets.approve', p_membership)
      or public.can_supervise(p_org, 'leave.approve', p_membership);
$$;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code text check (code is null or char_length(code) <= 32),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (description is null or char_length(description) <= 4000),
  site_label text check (site_label is null or char_length(site_label) <= 160),
  team_id uuid,
  manager_membership_id uuid,
  status text not null default 'active' check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date date,
  end_date date,
  budget_hours numeric(10, 2) check (budget_hours is null or budget_hours >= 0),
  budget_amount numeric(14, 2) check (budget_amount is null or budget_amount >= 0),
  budget_currency char(3) check (budget_currency is null or budget_currency ~ '^[A-Z]{3}$'),
  cost_center text check (cost_center is null or char_length(cost_center) <= 64),
  created_by uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, code),
  check (end_date is null or start_date is null or end_date >= start_date),
  check ((budget_amount is null) = (budget_currency is null)),
  foreign key (team_id, organization_id) references public.teams (id, organization_id) on delete set null (team_id),
  foreign key (manager_membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete set null (manager_membership_id)
);

create index projects_org_status_idx on public.projects (organization_id, status);
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();

create table public.project_members (
  project_id uuid not null,
  organization_id uuid not null,
  membership_id uuid not null,
  role text not null default 'member' check (role in ('member', 'lead')),
  created_at timestamptz not null default now(),
  primary key (project_id, membership_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade
);

create index project_members_membership_idx on public.project_members (membership_id);

create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
    where pm.project_id = p_project and pm.membership_id = public.my_membership_id(p.organization_id)
  ) or exists (
    select 1 from public.projects p where p.id = p_project and p.manager_membership_id = public.my_membership_id(p.organization_id)
  );
$$;

create or replace function public.can_view_project_row(p_org uuid, p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_org_member(p_org) and (
    public.has_permission(p_org, 'projects.view')
    or public.has_permission(p_org, 'projects.view', 'project', p_id)
    or public.is_project_member(p_id)
  );
$$;

create or replace function public.can_view_project(p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select public.can_view_project_row(organization_id, id) from public.projects where id = p_project), false); $$;

create or replace function public.can_edit_project(p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project and (
      public.has_permission(p.organization_id, 'projects.edit')
      or public.has_permission(p.organization_id, 'projects.edit', 'project', p.id)
      or p.manager_membership_id = public.my_membership_id(p.organization_id)
    )
  );
$$;

create or replace function public.can_assign_in(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_permission(p_org, 'tasks.assign')
      or (p_project is not null and (public.has_permission(p_org, 'tasks.assign', 'project', p_project) or public.can_edit_project(p_project)));
$$;

-- Project scope is now a valid permission scope.
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
    if not exists (select 1 from public.projects p where p.id = new.scope_id and p.organization_id = new.organization_id) then
      raise exception 'Project scope must reference a project in the same organization' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 8000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  estimate_hours numeric(8, 2) check (estimate_hours is null or estimate_hours >= 0),
  position double precision not null default extract(epoch from now()),
  created_by uuid not null references public.profiles (id),
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);

create index tasks_project_idx on public.tasks (project_id, status, position);
create index tasks_org_due_idx on public.tasks (organization_id, due_date);
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create table public.task_assignees (
  task_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete cascade
);

create index task_assignees_user_idx on public.task_assignees (user_id);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  organization_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete cascade
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

create or replace function public.is_task_assignee(p_task uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid()); $$;

create or replace function public.can_view_task_row(p_org uuid, p_id uuid, p_project uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_org_member(p_org) and (
    p_creator = auth.uid()
    or public.is_task_assignee(p_id)
    or (p_project is not null and public.can_view_project(p_project))
    or (p_project is null and public.has_permission(p_org, 'tasks.assign'))
  );
$$;

create or replace function public.can_view_task(p_task uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select public.can_view_task_row(organization_id, id, project_id, created_by) from public.tasks where id = p_task), false); $$;

create or replace function public.can_work_on_task(p_task uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t where t.id = p_task and public.is_org_member(t.organization_id) and (
      t.created_by = auth.uid() or public.is_task_assignee(t.id) or public.can_assign_in(t.organization_id, t.project_id)
      or (t.project_id is not null and public.is_project_member(t.project_id))
    )
  );
$$;

create or replace function public.guard_task()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.project_id is not null and not (public.can_assign_in(new.organization_id, new.project_id) or public.is_project_member(new.project_id)) then
      raise exception 'You can only add tasks to projects you work on' using errcode = '42501';
    end if;
  else
    if new.organization_id <> old.organization_id or new.created_by <> old.created_by then
      raise exception 'Task identity fields are immutable' using errcode = '42501';
    end if;
    if new.project_id is distinct from old.project_id and not public.can_assign_in(new.organization_id, new.project_id) then
      raise exception 'tasks.assign permission required to move tasks between projects' using errcode = '42501';
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

create trigger tasks_guard before insert or update on public.tasks for each row execute function public.guard_task();

create or replace function public.guard_task_assignee()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  t record;
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  select * into t from public.tasks where id = coalesce(new.task_id, old.task_id);
  if tg_op = 'INSERT' then
    if public.user_membership_id(t.organization_id, new.user_id) is null then
      raise exception 'That person is not an active member' using errcode = '23503';
    end if;
    -- Anyone who can work on a task may assign themselves; assigning others needs tasks.assign.
    if new.user_id <> auth.uid() and not public.can_assign_in(t.organization_id, t.project_id)
       and t.created_by <> auth.uid() then
      raise exception 'tasks.assign permission required' using errcode = '42501';
    end if;
    new.assigned_by := auth.uid();
    return new;
  end if;
  if old.user_id <> auth.uid() and not public.can_assign_in(t.organization_id, t.project_id) and t.created_by <> auth.uid() then
    raise exception 'tasks.assign permission required' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger task_assignees_guard before insert or delete on public.task_assignees
  for each row execute function public.guard_task_assignee();

create or replace function public.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  t record;
begin
  select * into t from public.tasks where id = new.task_id;
  perform public.notify(t.organization_id, new.user_id, 'task', 'New task: ' || t.title,
    case when t.due_date is not null then 'Due ' || to_char(t.due_date, 'DD Mon YYYY') else null end,
    '/o/' || public.org_slug(t.organization_id) || '/tasks/' || t.id);
  return null;
end;
$$;

create trigger task_assignees_notify after insert on public.task_assignees
  for each row execute function public.notify_task_assignment();

-- ---------------------------------------------------------------------------
-- Schedules (shifts)
-- ---------------------------------------------------------------------------

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 600),
  location text check (location is null or char_length(location) <= 160),
  project_id uuid,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade,
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete set null (project_id)
);

create index shifts_org_time_idx on public.shifts (organization_id, starts_at);
create index shifts_member_time_idx on public.shifts (membership_id, starts_at);
create trigger shifts_updated_at before update on public.shifts for each row execute function public.set_updated_at();

create or replace function public.can_schedule(p_org uuid, p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_permission(p_org, 'attendance.view.all')
      or public.can_supervise(p_org, 'attendance.view.team', p_membership);
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  kind text not null check (kind in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  occurred_at timestamptz not null default now(),
  source text not null default 'app' check (source in ('app', 'correction', 'admin')),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade
);

create index attendance_member_time_idx on public.attendance_events (membership_id, occurred_at);
create index attendance_org_time_idx on public.attendance_events (organization_id, occurred_at);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  kind text not null check (kind in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  occurred_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  check (occurred_at <= created_at + interval '1 minute'),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade
);

create index attendance_corrections_org_status_idx on public.attendance_corrections (organization_id, status);

-- Current state for a membership: 'out', 'in' or 'break'.
create or replace function public.attendance_state(p_membership uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case (select kind from public.attendance_events where membership_id = p_membership order by occurred_at desc, created_at desc limit 1)
    when 'clock_in' then 'in' when 'break_end' then 'in' when 'break_start' then 'break' else 'out' end;
$$;

-- Server-timestamped punch for the caller. Location is never collected.
create or replace function public.clock(p_org uuid, p_kind text, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_mid uuid := public.my_membership_id(p_org);
  v_state text;
  v_at timestamptz := now();
begin
  if v_mid is null or not public.has_permission(p_org, 'attendance.view.self') then
    raise exception 'You do not have attendance access here' using errcode = '42501';
  end if;
  v_state := public.attendance_state(v_mid);
  if (p_kind = 'clock_in' and v_state <> 'out')
     or (p_kind = 'clock_out' and v_state = 'out')
     or (p_kind = 'break_start' and v_state <> 'in')
     or (p_kind = 'break_end' and v_state <> 'break') then
    raise exception 'That action does not match your current status (%). Refresh and try again.', v_state using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  if p_kind = 'clock_out' and v_state = 'break' then
    insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
    values (p_org, v_mid, 'break_end', v_at, 'app', auth.uid());
  end if;
  insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, created_by)
  values (p_org, v_mid, p_kind, v_at, 'app', nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  perform set_config('wbh.trusted_op', 'off', true);
  return v_at;
end;
$$;

create or replace function public.review_attendance_correction(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.attendance_corrections%rowtype;
begin
  select * into c from public.attendance_corrections where id = p_id for update;
  if not found or c.status <> 'pending' then
    raise exception 'This request is no longer pending' using errcode = '22023';
  end if;
  if not (public.has_permission(c.organization_id, 'attendance.view.all') and c.membership_id <> public.my_membership_id(c.organization_id))
     and not public.can_supervise(c.organization_id, 'attendance.view.team', c.membership_id) then
    raise exception 'You cannot review this request' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.attendance_corrections
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_id;
  if p_approve then
    insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, created_by)
    values (c.organization_id, c.membership_id, c.kind, c.occurred_at, 'correction', left(c.reason, 300), auth.uid());
  end if;
  perform public.notify(c.organization_id, public.membership_user_of(c.membership_id), 'attendance',
    'Attendance correction ' || case when p_approve then 'approved' else 'rejected' end, p_note,
    '/o/' || public.org_slug(c.organization_id) || '/attendance');
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Timesheets
-- ---------------------------------------------------------------------------

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, week_start),
  unique (id, organization_id),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade
);

create index timesheets_org_status_idx on public.timesheets (organization_id, status, week_start);
create trigger timesheets_updated_at before update on public.timesheets for each row execute function public.set_updated_at();

create table public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  timesheet_id uuid not null,
  work_date date not null,
  project_id uuid,
  task_id uuid,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  category text not null default 'work' check (category in ('work', 'travel', 'training', 'admin', 'standby')),
  description text check (description is null or char_length(description) <= 500),
  is_overtime boolean not null default false,
  billable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (timesheet_id, organization_id) references public.timesheets (id, organization_id) on delete cascade,
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete restrict,
  foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete set null (task_id)
);

create index timesheet_entries_sheet_idx on public.timesheet_entries (timesheet_id, work_date);
create index timesheet_entries_project_idx on public.timesheet_entries (project_id);
create trigger timesheet_entries_updated_at before update on public.timesheet_entries for each row execute function public.set_updated_at();

create or replace function public.timesheet_owner_editable(p_sheet uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.timesheets t
    where t.id = p_sheet and t.status in ('draft', 'rejected')
      and t.membership_id = public.my_membership_id(t.organization_id)
  );
$$;

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

create trigger timesheet_entries_guard before insert or update or delete on public.timesheet_entries
  for each row execute function public.guard_timesheet_entry();

-- No more than 24 hours on any day.
create or replace function public.check_daily_hours()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select coalesce(sum(hours), 0) from public.timesheet_entries
      where timesheet_id = new.timesheet_id and work_date = new.work_date) > 24 then
    raise exception 'More than 24 hours logged on %', new.work_date using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger timesheet_entries_daily_cap after insert or update on public.timesheet_entries
  for each row execute function public.check_daily_hours();

create or replace function public.ensure_timesheet(p_org uuid, p_week date)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_mid uuid := public.my_membership_id(p_org);
  v_week date := p_week - (extract(isodow from p_week)::int - 1);
  v_id uuid;
begin
  if v_mid is null or not public.has_permission(p_org, 'timesheets.submit') then
    raise exception 'You do not have timesheet access here' using errcode = '42501';
  end if;
  insert into public.timesheets (organization_id, membership_id, week_start)
  values (p_org, v_mid, v_week)
  on conflict (membership_id, week_start) do nothing;
  select id into v_id from public.timesheets where membership_id = v_mid and week_start = v_week;
  return v_id;
end;
$$;

create or replace function public.submit_timesheet(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.timesheets%rowtype;
  v_mgr uuid;
begin
  select * into t from public.timesheets where id = p_id for update;
  if not found or t.membership_id <> public.my_membership_id(t.organization_id) then
    raise exception 'Timesheet not found' using errcode = '42501';
  end if;
  if t.status not in ('draft', 'rejected') then
    raise exception 'This timesheet has already been submitted' using errcode = '22023';
  end if;
  if not exists (select 1 from public.timesheet_entries where timesheet_id = p_id) then
    raise exception 'Add at least one entry before submitting' using errcode = '22023';
  end if;
  update public.timesheets set status = 'submitted', submitted_at = now(), reviewed_by = null, reviewed_at = null, review_note = null
    where id = p_id;
  select m2.user_id into v_mgr from public.organization_memberships m
    join public.organization_memberships m2 on m2.id = m.manager_membership_id
    where m.id = t.membership_id;
  perform public.notify(t.organization_id, v_mgr, 'timesheet',
    public.display_name_of(auth.uid()) || ' submitted a timesheet', 'Week of ' || to_char(t.week_start, 'DD Mon YYYY'),
    '/o/' || public.org_slug(t.organization_id) || '/approvals');
end;
$$;

create or replace function public.review_timesheet(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.timesheets%rowtype;
begin
  select * into t from public.timesheets where id = p_id for update;
  if not found or t.status <> 'submitted' then
    raise exception 'This timesheet is not waiting for review' using errcode = '22023';
  end if;
  if not public.can_supervise(t.organization_id, 'timesheets.approve', t.membership_id) then
    raise exception 'You cannot approve this timesheet' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Explain what needs to change when rejecting' using errcode = '22023';
  end if;
  update public.timesheets
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_id;
  perform public.notify(t.organization_id, public.membership_user_of(t.membership_id), 'timesheet',
    'Timesheet ' || case when p_approve then 'approved' else 'returned for changes' end,
    'Week of ' || to_char(t.week_start, 'DD Mon YYYY') || coalesce(': ' || p_note, ''),
    '/o/' || public.org_slug(t.organization_id) || '/timesheets?week=' || t.week_start);
end;
$$;

-- Approved timesheets are immutable.
create or replace function public.guard_timesheet()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return coalesce(new, old);
  end if;
  raise exception 'Use submit/review actions to change timesheets' using errcode = '42501';
end;
$$;

create trigger timesheets_guard before update or delete on public.timesheets
  for each row when (current_user in ('authenticated', 'anon')) execute function public.guard_timesheet();

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  color text not null default '#2f7d5b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  paid boolean not null default true,
  annual_days numeric(5, 1) check (annual_days is null or annual_days >= 0),
  requires_note boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

create table public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  holiday_date date not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  unique (organization_id, holiday_date)
);

create table public.leave_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  leave_type_id uuid not null,
  year integer not null check (year between 2000 and 2100),
  days numeric(5, 1) not null check (days between -365 and 365),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade,
  foreign key (leave_type_id, organization_id) references public.leave_types (id, organization_id) on delete restrict
);

-- Working days between two dates (Mon–Fri, excluding the organization's public holidays),
-- minus half days at either end.
create or replace function public.leave_days(p_org uuid, p_start date, p_end date, p_start_half boolean, p_end_half boolean)
returns numeric
language sql stable security definer set search_path = ''
as $$
  with days as (
    select d::date as d from generate_series(p_start, p_end, interval '1 day') d
    where extract(isodow from d) < 6
      and not exists (select 1 from public.public_holidays h where h.organization_id = p_org and h.holiday_date = d::date)
  )
  select greatest(0, count(*)
    - case when p_start_half and exists (select 1 from days where d = p_start) then 0.5 else 0 end
    - case when p_end_half and p_end <> p_start and exists (select 1 from days where d = p_end) then 0.5 else 0 end
  )::numeric from days;
$$;

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  leave_type_id uuid not null,
  start_date date not null,
  end_date date not null,
  start_half boolean not null default false,
  end_half boolean not null default false,
  days numeric(5, 1) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (end_date >= start_date and end_date - start_date <= 366),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade,
  foreign key (leave_type_id, organization_id) references public.leave_types (id, organization_id) on delete restrict,
  constraint leave_requests_no_overlap exclude using gist (
    membership_id with =, daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'approved'))
);

create index leave_requests_org_dates_idx on public.leave_requests (organization_id, start_date, end_date);

-- The reason can contain medical details: only the requester and HR (users.view.private) see it.
create table public.leave_request_reasons (
  request_id uuid primary key references public.leave_requests (id) on delete cascade,
  reason text not null check (char_length(reason) <= 1000)
);

create or replace function public.request_leave(
  p_org uuid, p_type uuid, p_start date, p_end date, p_start_half boolean, p_end_half boolean, p_reason text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_mid uuid := public.my_membership_id(p_org);
  v_days numeric;
  v_id uuid;
  v_type public.leave_types%rowtype;
  v_mgr uuid;
begin
  if v_mid is null or not public.has_permission(p_org, 'leave.request') then
    raise exception 'You do not have leave access here' using errcode = '42501';
  end if;
  select * into v_type from public.leave_types where id = p_type and organization_id = p_org and active;
  if not found then
    raise exception 'Choose a leave type' using errcode = '22023';
  end if;
  if v_type.requires_note and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '% requires a note', v_type.name using errcode = '22023';
  end if;
  v_days := public.leave_days(p_org, p_start, p_end, p_start_half, p_end_half);
  if v_days <= 0 then
    raise exception 'Those dates contain no working days' using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  insert into public.leave_requests (organization_id, membership_id, leave_type_id, start_date, end_date, start_half, end_half, days)
  values (p_org, v_mid, p_type, p_start, p_end, p_start_half, p_end_half, v_days)
  returning id into v_id;
  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    insert into public.leave_request_reasons (request_id, reason) values (v_id, left(btrim(p_reason), 1000));
  end if;
  perform set_config('wbh.trusted_op', 'off', true);
  select m2.user_id into v_mgr from public.organization_memberships m
    join public.organization_memberships m2 on m2.id = m.manager_membership_id where m.id = v_mid;
  perform public.notify(p_org, v_mgr, 'leave', public.display_name_of(auth.uid()) || ' requested ' || v_type.name,
    to_char(p_start, 'DD Mon') || ' – ' || to_char(p_end, 'DD Mon YYYY') || ' (' || v_days || ' days)',
    '/o/' || public.org_slug(p_org) || '/approvals');
  return v_id;
exception when exclusion_violation then
  raise exception 'You already have leave booked or pending on some of those days' using errcode = '23P01';
end;
$$;

create or replace function public.review_leave(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'This request is no longer pending' using errcode = '22023';
  end if;
  if not public.can_supervise(r.organization_id, 'leave.approve', r.membership_id) then
    raise exception 'You cannot approve this request' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.leave_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_id;
  perform set_config('wbh.trusted_op', 'off', true);
  perform public.notify(r.organization_id, public.membership_user_of(r.membership_id), 'leave',
    'Leave ' || case when p_approve then 'approved' else 'declined' end,
    to_char(r.start_date, 'DD Mon') || ' – ' || to_char(r.end_date, 'DD Mon YYYY') || coalesce(': ' || p_note, ''),
    '/o/' || public.org_slug(r.organization_id) || '/leave');
end;
$$;

create or replace function public.cancel_leave(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if not found or r.membership_id <> public.my_membership_id(r.organization_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'approved') or (r.status = 'approved' and r.start_date <= current_date) then
    raise exception 'This request can no longer be cancelled; ask your manager' using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.leave_requests set status = 'cancelled' where id = p_id;
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

-- Balances per leave type for one membership and year.
create or replace function public.leave_balances(p_org uuid, p_membership uuid, p_year integer)
returns table (leave_type_id uuid, name text, color text, paid boolean, allowance numeric, taken numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name, t.color, t.paid,
    case when t.annual_days is null then null else t.annual_days + coalesce((
      select sum(a.days) from public.leave_balance_adjustments a
      where a.membership_id = p_membership and a.leave_type_id = t.id and a.year = p_year), 0) end,
    coalesce((select sum(r.days) from public.leave_requests r where r.membership_id = p_membership and r.leave_type_id = t.id
              and r.status = 'approved' and extract(year from r.start_date) = p_year), 0),
    coalesce((select sum(r.days) from public.leave_requests r where r.membership_id = p_membership and r.leave_type_id = t.id
              and r.status = 'pending' and extract(year from r.start_date) = p_year), 0),
    case when t.annual_days is null then null else t.annual_days + coalesce((
      select sum(a.days) from public.leave_balance_adjustments a
      where a.membership_id = p_membership and a.leave_type_id = t.id and a.year = p_year), 0)
      - coalesce((select sum(r.days) from public.leave_requests r where r.membership_id = p_membership and r.leave_type_id = t.id
              and r.status = 'approved' and extract(year from r.start_date) = p_year), 0) end
  from public.leave_types t
  where t.organization_id = p_org and t.active and public.can_view_time_of(p_org, p_membership)
  order by t.name;
$$;

-- Pending items the caller can act on.
create or replace function public.my_approval_counts(p_org uuid)
returns table (timesheets bigint, leave bigint, corrections bigint)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from public.timesheets t where t.organization_id = p_org and t.status = 'submitted'
       and public.can_supervise(p_org, 'timesheets.approve', t.membership_id)),
    (select count(*) from public.leave_requests r where r.organization_id = p_org and r.status = 'pending'
       and public.can_supervise(p_org, 'leave.approve', r.membership_id)),
    (select count(*) from public.attendance_corrections c where c.organization_id = p_org and c.status = 'pending'
       and (public.can_supervise(p_org, 'attendance.view.team', c.membership_id)
            or (public.has_permission(p_org, 'attendance.view.all') and c.membership_id <> public.my_membership_id(p_org))));
$$;

-- Aggregate hours for a project (no per-person detail) for anyone who can see the project.
create or replace function public.project_hours(p_project uuid)
returns table (approved numeric, submitted numeric)
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(e.hours) filter (where t.status = 'approved'), 0),
         coalesce(sum(e.hours) filter (where t.status = 'submitted'), 0)
  from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
  where e.project_id = p_project and public.can_view_project(p_project);
$$;

-- Ids of the pending items the caller can act on (for the Approvals page).
create or replace function public.my_pending_approvals(p_org uuid)
returns table (kind text, id uuid)
language sql stable security definer set search_path = ''
as $$
  select 'timesheet', t.id from public.timesheets t where t.organization_id = p_org and t.status = 'submitted'
     and public.can_supervise(p_org, 'timesheets.approve', t.membership_id)
  union all
  select 'leave', r.id from public.leave_requests r where r.organization_id = p_org and r.status = 'pending'
     and public.can_supervise(p_org, 'leave.approve', r.membership_id)
  union all
  select 'correction', c.id from public.attendance_corrections c where c.organization_id = p_org and c.status = 'pending'
     and (public.can_supervise(p_org, 'attendance.view.team', c.membership_id)
          or (public.has_permission(p_org, 'attendance.view.all') and c.membership_id <> public.my_membership_id(p_org)));
$$;

-- ---------------------------------------------------------------------------
-- File access for tasks (attachments on tasks)
-- ---------------------------------------------------------------------------

create or replace function public.can_read_file(p_file uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  f record;
begin
  select * into f from public.files where id = p_file;
  if not found or not public.is_org_member(f.organization_id) then return false; end if;
  if f.context_type = 'message' then
    return exists (select 1 from public.messages m where m.id = f.context_id and m.deleted_at is null
                   and public.can_read_conversation(m.conversation_id));
  elsif f.context_type = 'document' then
    return exists (select 1 from public.documents d where d.id = f.context_id and public.can_read_folder(d.folder_id));
  elsif f.context_type = 'announcement' then
    return public.can_read_announcement(f.context_id);
  elsif f.context_type = 'task' then
    return public.can_view_task(f.context_id);
  elsif f.context_type = 'expense' then
    return f.uploaded_by = auth.uid();
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_comments enable row level security;
alter table public.shifts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.timesheets enable row level security;
alter table public.timesheet_entries enable row level security;
alter table public.leave_types enable row level security;
alter table public.public_holidays enable row level security;
alter table public.leave_balance_adjustments enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_request_reasons enable row level security;

grant select, insert on public.projects to authenticated;
grant update (code, name, description, site_label, team_id, manager_membership_id, status, start_date, end_date,
  budget_hours, budget_amount, budget_currency, cost_center, archived_at) on public.projects to authenticated;
create policy projects_select on public.projects for select to authenticated using (public.can_view_project_row(organization_id, id));
create policy projects_insert on public.projects for insert to authenticated
  with check (created_by = auth.uid() and (public.has_permission(organization_id, 'projects.create')
              or (team_id is not null and public.has_permission(organization_id, 'projects.create', 'team', team_id))));
create policy projects_update on public.projects for update to authenticated
  using (public.can_edit_project(id)) with check (public.is_org_member(organization_id));

grant select, insert, delete on public.project_members to authenticated;
grant update (role) on public.project_members to authenticated;
create policy project_members_select on public.project_members for select to authenticated using (public.can_view_project(project_id));
create policy project_members_insert on public.project_members for insert to authenticated with check (public.can_edit_project(project_id));
create policy project_members_update on public.project_members for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy project_members_delete on public.project_members for delete to authenticated using (public.can_edit_project(project_id));

grant select, insert on public.tasks to authenticated;
grant update (title, description, status, priority, due_date, estimate_hours, position, project_id, archived_at) on public.tasks to authenticated;
create policy tasks_select on public.tasks for select to authenticated using (public.can_view_task_row(organization_id, id, project_id, created_by));
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_org_member(organization_id));
create policy tasks_update on public.tasks for update to authenticated using (public.can_work_on_task(id)) with check (public.is_org_member(organization_id));

grant select, insert, delete on public.task_assignees to authenticated;
create policy task_assignees_select on public.task_assignees for select to authenticated using (public.can_view_task(task_id));
create policy task_assignees_insert on public.task_assignees for insert to authenticated with check (public.can_work_on_task(task_id));
create policy task_assignees_delete on public.task_assignees for delete to authenticated using (public.can_work_on_task(task_id));

grant select, insert, delete on public.task_checklist_items to authenticated;
grant update (title, done, position) on public.task_checklist_items to authenticated;
create policy checklist_select on public.task_checklist_items for select to authenticated using (public.can_view_task(task_id));
create policy checklist_write on public.task_checklist_items for insert to authenticated with check (public.can_work_on_task(task_id));
create policy checklist_update on public.task_checklist_items for update to authenticated using (public.can_work_on_task(task_id)) with check (public.can_work_on_task(task_id));
create policy checklist_delete on public.task_checklist_items for delete to authenticated using (public.can_work_on_task(task_id));

grant select, insert on public.task_comments to authenticated;
create policy task_comments_select on public.task_comments for select to authenticated using (public.can_view_task(task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_view_task(task_id));

grant select, insert, update, delete on public.shifts to authenticated;
create policy shifts_select on public.shifts for select to authenticated using (public.is_org_member(organization_id));
create policy shifts_insert on public.shifts for insert to authenticated with check (public.can_schedule(organization_id, membership_id) and created_by = auth.uid());
create policy shifts_update on public.shifts for update to authenticated using (public.can_schedule(organization_id, membership_id)) with check (public.can_schedule(organization_id, membership_id));
create policy shifts_delete on public.shifts for delete to authenticated using (public.can_schedule(organization_id, membership_id));

grant select on public.attendance_events to authenticated;
create policy attendance_select on public.attendance_events for select to authenticated using (public.can_view_time_of(organization_id, membership_id));

grant select, insert on public.attendance_corrections to authenticated;
create policy corrections_select on public.attendance_corrections for select to authenticated using (public.can_view_time_of(organization_id, membership_id));
create policy corrections_insert on public.attendance_corrections for insert to authenticated
  with check (membership_id = public.my_membership_id(organization_id) and status = 'pending' and reviewed_by is null);

grant select on public.timesheets to authenticated;
create policy timesheets_select on public.timesheets for select to authenticated using (public.can_view_time_of(organization_id, membership_id));

grant select, insert, update, delete on public.timesheet_entries to authenticated;
create policy entries_select on public.timesheet_entries for select to authenticated
  using (exists (select 1 from public.timesheets t where t.id = timesheet_id));
create policy entries_insert on public.timesheet_entries for insert to authenticated with check (public.timesheet_owner_editable(timesheet_id));
create policy entries_update on public.timesheet_entries for update to authenticated using (public.timesheet_owner_editable(timesheet_id)) with check (public.timesheet_owner_editable(timesheet_id));
create policy entries_delete on public.timesheet_entries for delete to authenticated using (public.timesheet_owner_editable(timesheet_id));

grant select, insert on public.leave_types to authenticated;
grant update (name, color, paid, annual_days, requires_note, active) on public.leave_types to authenticated;
create policy leave_types_select on public.leave_types for select to authenticated using (public.is_org_member(organization_id));
create policy leave_types_insert on public.leave_types for insert to authenticated with check (public.has_permission(organization_id, 'org.settings.manage'));
create policy leave_types_update on public.leave_types for update to authenticated using (public.has_permission(organization_id, 'org.settings.manage')) with check (public.has_permission(organization_id, 'org.settings.manage'));

grant select, insert, delete on public.public_holidays to authenticated;
create policy holidays_select on public.public_holidays for select to authenticated using (public.is_org_member(organization_id));
create policy holidays_insert on public.public_holidays for insert to authenticated with check (public.has_permission(organization_id, 'org.settings.manage'));
create policy holidays_delete on public.public_holidays for delete to authenticated using (public.has_permission(organization_id, 'org.settings.manage'));

grant select, insert on public.leave_balance_adjustments to authenticated;
create policy adjustments_select on public.leave_balance_adjustments for select to authenticated using (public.can_view_time_of(organization_id, membership_id));
create policy adjustments_insert on public.leave_balance_adjustments for insert to authenticated
  with check (created_by = auth.uid() and public.can_supervise(organization_id, 'leave.approve', membership_id)
              and public.has_permission(organization_id, 'users.edit'));

grant select on public.leave_requests to authenticated;
create policy leave_select on public.leave_requests for select to authenticated using (public.can_view_time_of(organization_id, membership_id));

grant select on public.leave_request_reasons to authenticated;
create policy leave_reasons_select on public.leave_request_reasons for select to authenticated
  using (exists (select 1 from public.leave_requests r where r.id = request_id
                 and (r.membership_id = public.my_membership_id(r.organization_id)
                      or public.has_permission(r.organization_id, 'users.view.private'))));

-- Whole-company leave calendar shows who is away (no type or reason) to every member.
create or replace function public.team_absences(p_org uuid, p_from date, p_to date)
returns table (membership_id uuid, user_id uuid, start_date date, end_date date, status text)
language sql stable security definer set search_path = ''
as $$
  select r.membership_id, m.user_id, r.start_date, r.end_date, r.status
  from public.leave_requests r join public.organization_memberships m on m.id = r.membership_id
  where r.organization_id = p_org and public.is_org_member(p_org) and r.status in ('approved', 'pending')
    and r.start_date <= p_to and r.end_date >= p_from and m.status = 'active';
$$;

-- Function grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.can_supervise(uuid, text, uuid)', 'public.membership_org(uuid)', 'public.membership_user_of(uuid)',
    'public.can_view_time_of(uuid, uuid)', 'public.is_project_member(uuid)', 'public.can_view_project_row(uuid, uuid)',
    'public.can_view_project(uuid)', 'public.can_edit_project(uuid)', 'public.can_assign_in(uuid, uuid)',
    'public.is_task_assignee(uuid)', 'public.can_view_task_row(uuid, uuid, uuid, uuid)', 'public.can_view_task(uuid)',
    'public.can_work_on_task(uuid)', 'public.can_schedule(uuid, uuid)', 'public.attendance_state(uuid)',
    'public.clock(uuid, text, text)', 'public.review_attendance_correction(uuid, boolean, text)',
    'public.timesheet_owner_editable(uuid)', 'public.ensure_timesheet(uuid, date)', 'public.submit_timesheet(uuid)',
    'public.review_timesheet(uuid, boolean, text)', 'public.leave_days(uuid, date, date, boolean, boolean)',
    'public.request_leave(uuid, uuid, date, date, boolean, boolean, text)', 'public.review_leave(uuid, boolean, text)',
    'public.cancel_leave(uuid)', 'public.leave_balances(uuid, uuid, integer)', 'public.my_approval_counts(uuid)',
    'public.team_absences(uuid, date, date)', 'public.can_read_file(uuid)', 'public.my_pending_approvals(uuid)', 'public.project_hours(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Audit: time and approval records.
create trigger audit_projects after insert or update or delete on public.projects for each row execute function public.audit_row_change('id', 'description');
create trigger audit_attendance_events after insert or update or delete on public.attendance_events for each row execute function public.audit_row_change();
create trigger audit_attendance_corrections after insert or update or delete on public.attendance_corrections for each row execute function public.audit_row_change('id', 'reason');
create trigger audit_timesheets after insert or update or delete on public.timesheets for each row execute function public.audit_row_change();
create trigger audit_leave_requests after insert or update or delete on public.leave_requests for each row execute function public.audit_row_change();
create trigger audit_leave_types after insert or update or delete on public.leave_types for each row execute function public.audit_row_change();
create trigger audit_leave_adjustments after insert or update or delete on public.leave_balance_adjustments for each row execute function public.audit_row_change();
create trigger audit_shifts after insert or update or delete on public.shifts for each row execute function public.audit_row_change('id', 'notes');

-- Default leave types for every organization.
create or replace function public.seed_organization_workforce(p_org uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.leave_types (organization_id, name, color, paid, annual_days, requires_note)
  values (p_org, 'Annual leave', '#2f7d5b', true, 25, false),
         (p_org, 'Sick leave', '#b3412e', true, null, false),
         (p_org, 'Unpaid leave', '#556770', false, null, true)
  on conflict (organization_id, name) do nothing;
end;
$$;

revoke all on function public.seed_organization_workforce(uuid) from public, anon, authenticated;

create or replace function public.seed_workforce_on_org()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform public.seed_organization_workforce(new.id); return null; end; $$;

create trigger organizations_seed_workforce after insert on public.organizations
  for each row execute function public.seed_workforce_on_org();

select public.seed_organization_workforce(id) from public.organizations;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.attendance_events;
  end if;
end $$;
