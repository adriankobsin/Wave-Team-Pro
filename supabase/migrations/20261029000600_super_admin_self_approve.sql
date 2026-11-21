-- Super admins may approve (or return) their own timesheets. Everyone else still can't review
-- their own time.
create or replace function public.is_super_admin_in(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.organization_memberships m
    join public.membership_role_assignments a on a.membership_id = m.id
    join public.roles r on r.id = a.role_id
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active' and r.key = 'super_admin'
  );
$$;

revoke all on function public.is_super_admin_in(uuid) from public, anon;
grant execute on function public.is_super_admin_in(uuid) to authenticated;

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
  if not (
    public.can_supervise(t.organization_id, 'timesheets.approve', t.membership_id)
    or (t.membership_id = public.my_membership_id(t.organization_id) and public.is_super_admin_in(t.organization_id))
  ) then
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
