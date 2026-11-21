-- Clock in to a company AND a project. People who work for several companies are only ever
-- clocked in to one at a time: clocking in elsewhere clocks them out here at the same moment.
-- Clocked time fills each company's timesheet by day and project (rows marked from_clock).

alter table public.attendance_events add column project_id uuid;
alter table public.attendance_events add constraint attendance_events_project_fk
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete restrict;
create index attendance_project_idx on public.attendance_events (project_id) where project_id is not null;

alter table public.timesheet_entries add column from_clock boolean not null default false;

-- The person's clock state across every company they belong to (theirs only).
create or replace function public.my_clock_status()
returns table (organization_id uuid, organization_name text, organization_slug text, membership_id uuid, state text, project_id uuid, project_name text, since timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.organization_id, o.name, o.slug, m.id,
         case e.kind when 'clock_in' then 'in' when 'break_end' then 'in' when 'break_start' then 'break' end,
         p.project_id, pr.name, e.occurred_at
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join lateral (select kind, occurred_at from public.attendance_events a where a.membership_id = m.id
                order by a.occurred_at desc, a.created_at desc limit 1) e on true
  left join lateral (select a.project_id from public.attendance_events a where a.membership_id = m.id and a.kind = 'clock_in'
                     order by a.occurred_at desc, a.created_at desc limit 1) p on true
  left join public.projects pr on pr.id = p.project_id
  where m.user_id = auth.uid() and m.status = 'active' and e.kind <> 'clock_out';
$$;

revoke all on function public.my_clock_status() from public, anon;
grant execute on function public.my_clock_status() to authenticated;

/**
 * kind: clock_in | clock_out | break_start | break_end | switch (change project while working).
 * p_project: required for clock_in and switch when the company has active projects the person can see;
 * optional otherwise. Returns the time recorded.
 */
create or replace function public.clock_on(p_org uuid, p_kind text, p_project uuid default null, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_mid uuid := public.my_membership_id(p_org);
  v_state text;
  v_at timestamptz := clock_timestamp();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  o record;
begin
  if v_mid is null or not public.has_permission(p_org, 'attendance.view.self') then
    raise exception 'You do not have attendance access here' using errcode = '42501';
  end if;
  if p_kind not in ('clock_in', 'clock_out', 'break_start', 'break_end', 'switch') then
    raise exception 'Unknown clock action' using errcode = '22023';
  end if;
  if p_project is not null then
    if not exists (select 1 from public.projects where id = p_project and organization_id = p_org and status in ('planning', 'active', 'on_hold'))
       or not public.can_view_project(p_project) then
      raise exception 'You cannot clock in to that project' using errcode = '42501';
    end if;
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

  -- One company at a time: clock out of any other company first, at the same moment.
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
    values (p_org, v_mid, 'clock_in', v_at, 'app', v_note, p_project, auth.uid());
  else
    if p_kind = 'clock_out' and v_state = 'break' then
      insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
      values (p_org, v_mid, 'break_end', v_at - interval '1 millisecond', 'app', auth.uid());
    end if;
    insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, note, project_id, created_by)
    values (p_org, v_mid, p_kind, v_at, 'app', v_note, case when p_kind = 'clock_in' then p_project end, auth.uid());
  end if;

  perform set_config('wbh.trusted_op', 'off', true);
  return v_at;
end;
$$;

revoke all on function public.clock_on(uuid, text, uuid, text) from public, anon;
grant execute on function public.clock_on(uuid, text, uuid, text) to authenticated;

-- The original entry point keeps working (no project).
create or replace function public.clock(p_org uuid, p_kind text, p_note text default null)
returns timestamptz
language sql security definer set search_path = ''
as $$ select public.clock_on(p_org, p_kind, null, p_note); $$;

-- Management alert names the project; project switches don't alert.
create or replace function public.mgmt_on_clock()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := public.membership_user_of(new.membership_id);
  v_tz text;
  v_project text;
begin
  if new.kind not in ('clock_in', 'clock_out') or new.note in ('Switched project') then
    return null;
  end if;
  select timezone into v_tz from public.organizations where id = new.organization_id;
  if new.project_id is not null then
    select coalesce(code || ' ', '') || name into v_project from public.projects where id = new.project_id;
  end if;
  perform public.notify_management(new.organization_id, 'clock',
    coalesce(public.display_name_of(v_user), 'Someone') || case new.kind when 'clock_in' then ' clocked in' else ' clocked out' end
      || ' at ' || to_char(new.occurred_at at time zone coalesce(v_tz, 'UTC'), 'HH24:MI'),
    coalesce(v_project || ' · ', '') ||
    case when new.source = 'correction' then 'Approved correction'
         when new.note = 'Clocked in at another company' then 'Moved to another company'
         else to_char(new.occurred_at at time zone coalesce(v_tz, 'UTC'), 'Dy DD Mon') end,
    '/o/' || public.org_slug(new.organization_id) || '/timesheets?person=' || new.membership_id || '#calendar', v_user);
  return null;
end;
$$;

revoke all on function public.mgmt_on_clock() from public, anon, authenticated;
