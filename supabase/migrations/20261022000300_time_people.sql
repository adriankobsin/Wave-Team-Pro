-- People whose attendance/timesheets the current user may see (themselves, their team, or
-- everyone for attendance.view.all), with the date they joined the organization.
create or replace function public.time_people(p_org uuid)
returns table (membership_id uuid, joined date)
language sql stable security definer set search_path = ''
as $$
  select m.id, (m.created_at at time zone 'UTC')::date
  from public.organization_memberships m
  where m.organization_id = p_org and m.status = 'active' and public.can_view_time_of(p_org, m.id);
$$;

revoke all on function public.time_people(uuid) from public, anon;
grant execute on function public.time_people(uuid) to authenticated;
