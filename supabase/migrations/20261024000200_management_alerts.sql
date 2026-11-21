-- Management notifications: HR, admins and directors are told about new joiners, uploads,
-- timesheet submissions, clock in/out, and receive the weekly all-staff timesheet.

-- Director role (template for new organizations, added to existing ones).
create or replace function public.seed_director_role(p_org uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role uuid;
begin
  perform set_config('wbh.trusted_op', 'on', true);
  insert into public.roles (organization_id, key, name, description, is_system, is_protected)
  values (p_org, 'director', 'Director', 'Company oversight: reports, all attendance and expenses, approvals.', true, false)
  on conflict (organization_id, key) do nothing
  returning id into v_role;
  if v_role is not null then
    insert into public.role_permissions (organization_id, role_id, permission_key)
    select p_org, v_role, k from unnest(array[
      'users.view', 'reports.view', 'reports.export', 'attendance.view.all', 'timesheets.approve', 'leave.approve',
      'expenses.view.all', 'expenses.approve', 'projects.view', 'documents.read', 'documents.upload',
      'announcements.publish', 'chat.channel.create', 'attendance.view.self', 'timesheets.submit', 'leave.request',
      'expenses.create', 'expenses.view.self'
    ]) k
    where exists (select 1 from public.permissions p where p.key = k)
    on conflict do nothing;
  end if;
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

revoke all on function public.seed_director_role(uuid) from public, anon, authenticated;

create or replace function public.seed_director_on_org()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform public.seed_director_role(new.id); return null; end; $$;

revoke all on function public.seed_director_on_org() from public, anon, authenticated;

create trigger organizations_seed_director after insert on public.organizations
  for each row execute function public.seed_director_on_org();

select public.seed_director_role(id) from public.organizations;

-- Per-event settings and explicit recipients. With no settings row, the defaults apply:
-- everyone holding the Super Admin, HR Manager, Admin/VA or Director role.
create table public.management_alert_events (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  event text not null check (event in ('member_joined', 'upload', 'timesheet_submitted', 'clock', 'weekly_timesheets')),
  enabled boolean not null default true,
  email boolean not null default false,
  custom_recipients boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, event)
);

create table public.management_alert_recipients (
  organization_id uuid not null,
  event text not null,
  membership_id uuid not null,
  primary key (organization_id, event, membership_id),
  foreign key (organization_id, event) references public.management_alert_events (organization_id, event) on delete cascade,
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade
);

alter table public.management_alert_events enable row level security;
alter table public.management_alert_recipients enable row level security;

grant select, insert on public.management_alert_events to authenticated;
grant update (enabled, email, custom_recipients) on public.management_alert_events to authenticated;
create policy mae_select on public.management_alert_events for select to authenticated using (public.is_org_member(organization_id));
create policy mae_insert on public.management_alert_events for insert to authenticated with check (public.has_permission(organization_id, 'org.settings.manage'));
create policy mae_update on public.management_alert_events for update to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage')) with check (public.has_permission(organization_id, 'org.settings.manage'));

grant select, insert, delete on public.management_alert_recipients to authenticated;
create policy mar_select on public.management_alert_recipients for select to authenticated using (public.is_org_member(organization_id));
create policy mar_insert on public.management_alert_recipients for insert to authenticated with check (public.has_permission(organization_id, 'org.settings.manage'));
create policy mar_delete on public.management_alert_recipients for delete to authenticated using (public.has_permission(organization_id, 'org.settings.manage'));

create trigger audit_management_alert_events after insert or update on public.management_alert_events
  for each row execute function public.audit_row_change('organization_id');

-- Who receives an event (user ids of active members), and whether they also get email.
create or replace function public.management_recipients(p_org uuid, p_event text)
returns table (user_id uuid, membership_id uuid, email boolean)
language sql stable security definer set search_path = ''
as $$
  with s as (select * from public.management_alert_events where organization_id = p_org and event = p_event)
  select distinct m.user_id, m.id, coalesce((select email from s), false)
  from public.organization_memberships m
  where m.organization_id = p_org and m.status = 'active'
    and coalesce((select enabled from s), true)
    and (
      (coalesce((select custom_recipients from s), false)
        and exists (select 1 from public.management_alert_recipients r where r.organization_id = p_org and r.event = p_event and r.membership_id = m.id))
      or (not coalesce((select custom_recipients from s), false)
        and exists (select 1 from public.membership_role_assignments a join public.roles ro on ro.id = a.role_id
                    where a.membership_id = m.id and a.scope_type = 'organization'
                      and ro.key in ('super_admin', 'hr_manager', 'va_admin', 'director')))
    );
$$;

revoke all on function public.management_recipients(uuid, text) from public, anon;
grant execute on function public.management_recipients(uuid, text) to authenticated;

create or replace function public.notify_management(p_org uuid, p_event text, p_title text, p_body text, p_link text, p_actor uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notifications (organization_id, user_id, kind, title, body, link, actor_id)
  select p_org, r.user_id, 'management', left(p_title, 200), left(p_body, 300), p_link, p_actor
  from public.management_recipients(p_org, p_event) r
  where r.user_id is distinct from p_actor;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_management(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Event triggers -------------------------------------------------------------

create or replace function public.mgmt_on_invitation_accepted()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_mid uuid;
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    v_name := coalesce(public.display_name_of(new.accepted_by), new.display_name, new.email::text);
    v_mid := public.user_membership_id(new.organization_id, new.accepted_by);
    perform public.notify_management(new.organization_id, 'member_joined', v_name || ' has joined',
      'Registration complete' || coalesce(' · ' || new.job_title, ''),
      '/o/' || public.org_slug(new.organization_id) || '/people' || coalesce('/' || v_mid::text, ''), new.accepted_by);
  end if;
  return null;
end;
$$;

create trigger invitations_mgmt_accepted after update on public.invitations
  for each row execute function public.mgmt_on_invitation_accepted();

create or replace function public.mgmt_on_file_uploaded()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text := public.org_slug(new.organization_id);
  v_link text;
  v_where text;
begin
  if new.context_type = 'message' then
    return null; -- chat attachments stay private to the conversation
  end if;
  v_where := case new.context_type when 'document' then 'Documents' when 'expense' then 'a receipt' when 'task' then 'a task' else 'an announcement' end;
  v_link := case new.context_type
    when 'expense' then '/o/' || v_slug || '/expenses/' || new.context_id
    when 'task' then '/o/' || v_slug || '/tasks/' || new.context_id
    when 'announcement' then '/o/' || v_slug || '/announcements'
    else '/o/' || v_slug || '/documents' end;
  perform public.notify_management(new.organization_id, 'upload',
    coalesce(public.display_name_of(new.uploaded_by), 'Someone') || ' uploaded ' || new.file_name,
    'Added to ' || v_where, v_link, new.uploaded_by);
  return null;
end;
$$;

create trigger files_mgmt_uploaded after insert on public.files
  for each row execute function public.mgmt_on_file_uploaded();

create or replace function public.mgmt_on_timesheet_submitted()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := public.membership_user_of(new.membership_id);
  v_hours numeric;
begin
  if new.status = 'submitted' and old.status <> 'submitted' then
    select coalesce(sum(hours), 0) into v_hours from public.timesheet_entries where timesheet_id = new.id;
    perform public.notify_management(new.organization_id, 'timesheet_submitted',
      coalesce(public.display_name_of(v_user), 'Someone') || ' submitted a timesheet',
      'Week of ' || to_char(new.week_start, 'DD Mon YYYY') || ' · ' || v_hours || ' h',
      '/o/' || public.org_slug(new.organization_id) || '/approvals', v_user);
  end if;
  return null;
end;
$$;

create trigger timesheets_mgmt_submitted after update on public.timesheets
  for each row execute function public.mgmt_on_timesheet_submitted();

create or replace function public.mgmt_on_clock()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := public.membership_user_of(new.membership_id);
  v_tz text;
begin
  if new.kind not in ('clock_in', 'clock_out') then
    return null;
  end if;
  select timezone into v_tz from public.organizations where id = new.organization_id;
  perform public.notify_management(new.organization_id, 'clock',
    coalesce(public.display_name_of(v_user), 'Someone') || case new.kind when 'clock_in' then ' clocked in' else ' clocked out' end
      || ' at ' || to_char(new.occurred_at at time zone coalesce(v_tz, 'UTC'), 'HH24:MI'),
    case when new.source = 'correction' then 'Approved correction' else to_char(new.occurred_at at time zone coalesce(v_tz, 'UTC'), 'Dy DD Mon') end,
    '/o/' || public.org_slug(new.organization_id) || '/timesheets?person=' || new.membership_id || '#calendar', v_user);
  return null;
end;
$$;

create trigger attendance_mgmt_clock after insert on public.attendance_events
  for each row execute function public.mgmt_on_clock();

revoke all on function public.mgmt_on_invitation_accepted() from public, anon, authenticated;
revoke all on function public.mgmt_on_file_uploaded() from public, anon, authenticated;
revoke all on function public.mgmt_on_timesheet_submitted() from public, anon, authenticated;
revoke all on function public.mgmt_on_clock() from public, anon, authenticated;
