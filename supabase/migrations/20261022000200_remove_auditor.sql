-- The read-only Auditor role is not used: stop creating it for new organizations and
-- remove it from existing ones where nobody holds it.
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

do $$
begin
  perform set_config('wbh.trusted_op', 'on', true);
  delete from public.roles r
  where r.key = 'auditor'
    and not exists (select 1 from public.membership_role_assignments a where a.role_id = r.id)
    and not exists (select 1 from public.invitations i where i.role_id = r.id);
  perform set_config('wbh.trusted_op', 'off', true);
end $$;
