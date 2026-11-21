-- One call for everything Group Hub (group view) needs about the viewer's companies,
-- instead of seven permission checks per company.
create or replace function public.my_companies()
returns table (
  organization_id uuid, name text, slug text, timezone text, country text, base_currency text, created_at timestamptz,
  can_staff boolean, can_manage_staff boolean, can_time boolean, can_expenses boolean, can_settings boolean, is_platform_admin boolean
)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.name, o.slug, o.timezone, o.country::text, o.base_currency::text, o.created_at,
    public.has_permission(o.id, 'users.view') or public.has_permission(o.id, 'users.edit') or public.has_permission(o.id, 'roles.manage'),
    public.has_permission(o.id, 'users.edit') or public.has_permission(o.id, 'roles.manage'),
    public.has_permission(o.id, 'timesheets.approve') or public.has_permission(o.id, 'attendance.view.all'),
    public.has_permission(o.id, 'expenses.view.all'),
    public.has_permission(o.id, 'org.settings.manage'),
    public.is_platform_admin()
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid() and m.status = 'active' and o.status = 'active'
  order by o.name;
$$;

revoke all on function public.my_companies() from public, anon;
grant execute on function public.my_companies() to authenticated;
