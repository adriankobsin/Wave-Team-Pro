-- Wave Team Pro — Row Level Security and grants (default deny).
-- anon gets nothing. authenticated gets table privileges narrowed by RLS and column grants.

-- Remove the broad defaults Supabase grants on new tables, then grant deliberately.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated;

-- Future objects created by migrations start closed too; each migration grants explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.team_memberships enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_role_assignments enable row level security;
alter table public.scoped_permission_overrides enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: visible to self and to anyone sharing an active organization.
-- Users edit only presentation fields of their own profile (column grants).
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, avatar_path, avatar_thumb_path, locale, timezone) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_active_org(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select on public.profile_private to authenticated;
grant update (legal_name, phone) on public.profile_private to authenticated;

create policy profile_private_select on public.profile_private for select to authenticated
  using (public.can_view_private_profile(user_id));
create policy profile_private_update on public.profile_private for update to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_private_profile(user_id))
  with check (user_id = (select auth.uid()) or public.can_manage_private_profile(user_id));

grant select on public.platform_admins to authenticated;
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant update (name, legal_entity_code, base_currency, timezone, country) on public.organizations to authenticated;

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id) or (public.is_platform_admin() and created_by = (select auth.uid())));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_permission(id, 'org.settings.manage'))
  with check (public.has_permission(id, 'org.settings.manage'));

grant select on public.organization_settings to authenticated;
grant update (mfa_required_for_sensitive, invitation_expiry_days, directory_show_email)
  on public.organization_settings to authenticated;

create policy org_settings_select on public.organization_settings for select to authenticated
  using (public.is_org_member(organization_id));
create policy org_settings_update on public.organization_settings for update to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage'))
  with check (public.has_permission(organization_id, 'org.settings.manage'));

-- ---------------------------------------------------------------------------
-- structure
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.departments to authenticated;
grant update (name, code, archived_at) on public.departments to authenticated;
create policy departments_select on public.departments for select to authenticated
  using (public.is_org_member(organization_id));
create policy departments_insert on public.departments for insert to authenticated
  with check (public.has_permission(organization_id, 'org.structure.manage'));
create policy departments_update on public.departments for update to authenticated
  using (public.has_permission(organization_id, 'org.structure.manage'))
  with check (public.has_permission(organization_id, 'org.structure.manage'));
create policy departments_delete on public.departments for delete to authenticated
  using (public.has_permission(organization_id, 'org.structure.manage'));

grant select, insert, delete on public.teams to authenticated;
grant update (name, description, department_id, archived_at) on public.teams to authenticated;
create policy teams_select on public.teams for select to authenticated
  using (public.is_org_member(organization_id));
create policy teams_insert on public.teams for insert to authenticated
  with check (public.has_permission(organization_id, 'org.structure.manage'));
create policy teams_update on public.teams for update to authenticated
  using (public.has_permission(organization_id, 'org.structure.manage'))
  with check (public.has_permission(organization_id, 'org.structure.manage'));
create policy teams_delete on public.teams for delete to authenticated
  using (public.has_permission(organization_id, 'org.structure.manage'));

grant select, insert, delete on public.team_memberships to authenticated;
grant update (is_lead) on public.team_memberships to authenticated;
create policy team_memberships_select on public.team_memberships for select to authenticated
  using (public.is_org_member(organization_id));
create policy team_memberships_write on public.team_memberships for insert to authenticated
  with check (public.has_permission(organization_id, 'org.structure.manage'));
create policy team_memberships_update on public.team_memberships for update to authenticated
  using (public.has_permission(organization_id, 'org.structure.manage'))
  with check (public.has_permission(organization_id, 'org.structure.manage'));
create policy team_memberships_delete on public.team_memberships for delete to authenticated
  using (public.has_permission(organization_id, 'org.structure.manage'));

-- ---------------------------------------------------------------------------
-- memberships: directory-visible inside the organization; own rows always visible
-- (so a deactivated person can be told why access ended).
-- ---------------------------------------------------------------------------
grant select on public.organization_memberships to authenticated;
grant update (employee_number, department_id, job_title, manager_membership_id, start_date, status)
  on public.organization_memberships to authenticated;
create policy memberships_select on public.organization_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(organization_id));
create policy memberships_update on public.organization_memberships for update to authenticated
  using (public.has_permission(organization_id, 'users.edit')
         or public.has_permission(organization_id, 'users.deactivate'))
  with check (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- permissions catalog, roles, assignments, overrides
-- ---------------------------------------------------------------------------
grant select on public.permissions to authenticated;
create policy permissions_select on public.permissions for select to authenticated using (true);

grant select, insert, delete on public.roles to authenticated;
grant update (name, description) on public.roles to authenticated;
create policy roles_select on public.roles for select to authenticated
  using (public.is_org_member(organization_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (public.has_permission(organization_id, 'roles.manage'));
create policy roles_update on public.roles for update to authenticated
  using (public.has_permission(organization_id, 'roles.manage'))
  with check (public.has_permission(organization_id, 'roles.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (public.has_permission(organization_id, 'roles.manage'));

grant select, insert, delete on public.role_permissions to authenticated;
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (public.is_org_member(organization_id));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (public.has_permission(organization_id, 'roles.manage'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (public.has_permission(organization_id, 'roles.manage'));

grant select, insert, delete on public.membership_role_assignments to authenticated;
create policy role_assignments_select on public.membership_role_assignments for select to authenticated
  using (public.is_org_member(organization_id));
create policy role_assignments_insert on public.membership_role_assignments for insert to authenticated
  with check (public.has_permission(organization_id, 'roles.manage'));
create policy role_assignments_delete on public.membership_role_assignments for delete to authenticated
  using (public.has_permission(organization_id, 'roles.manage'));

grant select, insert, delete on public.scoped_permission_overrides to authenticated;
create policy overrides_select on public.scoped_permission_overrides for select to authenticated
  using (public.has_permission(organization_id, 'roles.manage')
         or membership_id = public.my_membership_id(organization_id));
create policy overrides_insert on public.scoped_permission_overrides for insert to authenticated
  with check (public.has_permission(organization_id, 'roles.manage'));
create policy overrides_delete on public.scoped_permission_overrides for delete to authenticated
  using (public.has_permission(organization_id, 'roles.manage'));

-- ---------------------------------------------------------------------------
-- invitations: managed by users.invite holders. Invitees use list/accept RPCs.
-- ---------------------------------------------------------------------------
grant select, insert on public.invitations to authenticated;
grant update (status, expires_at) on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_permission(organization_id, 'users.invite'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.has_permission(organization_id, 'users.invite'));
create policy invitations_update on public.invitations for update to authenticated
  using (public.has_permission(organization_id, 'users.invite'))
  with check (public.has_permission(organization_id, 'users.invite'));

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and public.has_permission(organization_id, 'audit.view'));

-- ---------------------------------------------------------------------------
-- Functions callable by signed-in users (everything else stays internal).
-- ---------------------------------------------------------------------------
grant execute on function public.has_permission(uuid, text, text, uuid) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.my_organizations() to authenticated;
grant execute on function public.list_my_pending_invitations() to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.create_organization(text, text, text, text, text, text) to authenticated;
grant execute on function public.create_initial_invitation(uuid, text, text) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- Helpers used inside policies must remain executable by the policy caller.
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.my_membership_id(uuid) to authenticated;
grant execute on function public.shares_active_org(uuid) to authenticated;
grant execute on function public.can_view_private_profile(uuid) to authenticated;
grant execute on function public.can_manage_private_profile(uuid) to authenticated;
grant execute on function public.is_trusted_db_context() to authenticated;
grant execute on function public.membership_user(uuid) to authenticated;
grant execute on function public.assert_holds_role_permissions(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.is_protected_role(uuid) to authenticated;
grant execute on function public.membership_has_protected_role(uuid) to authenticated;
grant execute on function public.session_is_aal2() to authenticated;
grant execute on function public.is_valid_timezone(text) to authenticated;
grant execute on function public.my_verified_email() to authenticated;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.validate_timezone_column() to authenticated;
