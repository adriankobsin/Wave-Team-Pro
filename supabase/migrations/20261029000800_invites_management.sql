-- Management can send invites and updates too: Directors, HR Managers, Project Managers and
-- Team Leaders, alongside Super Admins and Admin / Virtual Assistants (PAs).
insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'invites.send'
from public.roles r
where r.key in ('super_admin', 'va_admin', 'director', 'hr_manager', 'project_manager', 'team_leader')
on conflict do nothing;

-- Companies created later: the same roles get it when they're seeded.
create or replace function public.grant_invites_to_management_role()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_system and new.key in ('va_admin', 'director', 'hr_manager', 'project_manager', 'team_leader') then
    perform set_config('wbh.trusted_op', 'on', true);
    insert into public.role_permissions (organization_id, role_id, permission_key)
    values (new.organization_id, new.id, 'invites.send')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.grant_invites_to_management_role() from public, anon, authenticated;
create or replace trigger roles_grant_invites after insert on public.roles
  for each row execute function public.grant_invites_to_management_role();
