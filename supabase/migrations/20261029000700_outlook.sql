-- Outlook: calendar invites and updates from one shared mailbox (Microsoft Graph, app-only).
-- Tasks with due dates, shifts, project assignments and approved leave become calendar invites
-- automatically; PAs and super admins also send invites (travel, meetings) and email updates by hand.

insert into public.permissions (key, module, description, allowed_scopes, is_sensitive, sort_order) values
  ('invites.send', 'communications', 'Send calendar invites and updates to staff through Outlook', '{organization}', false, 95)
on conflict (key) do nothing;

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'invites.send'
from public.roles r
where r.key in ('super_admin', 'va_admin')
on conflict do nothing;

-- New companies: PAs (Admin / Virtual Assistant) get it too.
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
              'attendance.view.self','timesheets.submit','leave.request','expenses.create','expenses.view.self','work.self_manage',
              'invites.send']),
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

-- One row for the whole group: the shared mailbox and which automatic invites are on.
create table public.outlook_settings (
  id boolean primary key default true check (id),
  mailbox text check (mailbox is null or mailbox ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  auto_kinds text[] not null default '{task,shift,project,leave}',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.outlook_settings (id) values (true) on conflict do nothing;
alter table public.outlook_settings enable row level security;
grant select on public.outlook_settings to authenticated;
create policy outlook_settings_select on public.outlook_settings for select to authenticated using (true);

-- Invites and updates written by PAs and super admins.
create table public.calendar_broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null check (kind in ('invite', 'update')),
  category text not null default 'other' check (category in ('travel', 'company', 'project', 'meeting', 'other')),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  body text check (body is null or char_length(body) <= 8000),
  location text check (location is null or char_length(location) <= 300),
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default false,
  time_zone text not null default 'UTC',
  audience text check (audience is null or char_length(audience) <= 500),
  attendee_emails text[] not null,
  attendee_user_ids uuid[] not null default '{}',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (kind = 'update' or (starts_at is not null and ends_at is not null and ends_at > starts_at))
);
create index calendar_broadcasts_org_idx on public.calendar_broadcasts (organization_id, created_at desc);
alter table public.calendar_broadcasts enable row level security;
grant select on public.calendar_broadcasts to authenticated;
create policy calendar_broadcasts_select on public.calendar_broadcasts for select to authenticated
  using (public.has_permission(organization_id, 'invites.send') or auth.uid() = any (attendee_user_ids));

-- What has to be (re)sent to Outlook. Written by triggers and the server; read by senders.
create table public.calendar_sync (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('task', 'shift', 'project', 'leave', 'manual')),
  ref_id uuid not null,
  graph_event_id text,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, ref_id)
);
create index calendar_sync_due_idx on public.calendar_sync (status, next_attempt_at);
alter table public.calendar_sync enable row level security;
grant select on public.calendar_sync to authenticated;
create policy calendar_sync_select on public.calendar_sync for select to authenticated
  using (public.has_permission(organization_id, 'invites.send'));

create or replace function public.outlook_touch(p_org uuid, p_kind text, p_ref uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.calendar_sync (organization_id, kind, ref_id)
  values (p_org, p_kind, p_ref)
  on conflict (kind, ref_id) do update
    set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null,
        organization_id = excluded.organization_id, updated_at = now();
$$;
revoke all on function public.outlook_touch(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.outlook_on_task()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(new.due_date, old.due_date) is not null or (tg_op = 'UPDATE' and old.due_date is not null) then
    perform public.outlook_touch(new.organization_id, 'task', new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.outlook_on_task() from public, anon, authenticated;
create or replace trigger tasks_outlook after insert or update of title, description, due_date, archived_at on public.tasks
  for each row execute function public.outlook_on_task();

create or replace function public.outlook_on_task_assignee()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r record := coalesce(new, old);
begin
  if exists (select 1 from public.tasks where id = r.task_id and due_date is not null) then
    perform public.outlook_touch(r.organization_id, 'task', r.task_id);
  end if;
  return null;
end;
$$;
revoke all on function public.outlook_on_task_assignee() from public, anon, authenticated;
create or replace trigger task_assignees_outlook after insert or delete on public.task_assignees
  for each row execute function public.outlook_on_task_assignee();

create or replace function public.outlook_on_shift()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r record := coalesce(new, old);
begin
  perform public.outlook_touch(r.organization_id, 'shift', r.id);
  return null;
end;
$$;
revoke all on function public.outlook_on_shift() from public, anon, authenticated;
create or replace trigger shifts_outlook after insert or update or delete on public.shifts
  for each row execute function public.outlook_on_shift();

create or replace function public.outlook_on_project()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.outlook_touch(new.organization_id, 'project', new.id);
  return null;
end;
$$;
revoke all on function public.outlook_on_project() from public, anon, authenticated;
create or replace trigger projects_outlook after update of name, site_label, country, start_date, end_date, status, organization_id, manager_membership_id on public.projects
  for each row execute function public.outlook_on_project();

create or replace function public.outlook_on_project_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r record := coalesce(new, old);
begin
  perform public.outlook_touch(r.organization_id, 'project', r.project_id);
  return null;
end;
$$;
revoke all on function public.outlook_on_project_member() from public, anon, authenticated;
create or replace trigger project_members_outlook after insert or delete on public.project_members
  for each row execute function public.outlook_on_project_member();

create or replace function public.outlook_on_leave()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    perform public.outlook_touch(new.organization_id, 'leave', new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.outlook_on_leave() from public, anon, authenticated;
create or replace trigger leave_requests_outlook after insert or update of status, start_date, end_date on public.leave_requests
  for each row execute function public.outlook_on_leave();
