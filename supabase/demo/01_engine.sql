-- Wave Team Pro demo engine. Apply ONLY to the demo project (never to a live company database).
-- Keeps the fictional demo company "alive": hourly it records the day's clock-ins as the local time
-- passes, closes finished weeks' timesheets (submitted, then approved), plans the next week's
-- shifts, and moves the fixed demo story (tasks, leave, expenses, chat, invites) forward by the
-- days that have passed, so the demo always looks like today. It only inserts and updates rows.

create schema if not exists demo;
revoke all on schema demo from public, anon, authenticated;

create table if not exists demo.state (
  id int primary key default 1 check (id = 1),
  anchor date not null,          -- the date the fixed story is currently aligned to
  started date not null,         -- first day of generated attendance
  seeded_at timestamptz not null default now()
);

-- People whose day is simulated (one company each).
create table if not exists demo.workers (
  membership_id uuid primary key,
  organization_id uuid not null,
  user_id uuid not null,
  tz text not null,
  project_id uuid,
  reviewer uuid,                 -- who approves their timesheets
  site text,
  in_min int not null,           -- minutes after midnight, local
  out_min int not null,
  break_min int not null
);

-- Rows that belong to the fixed story and move with the calendar.
create table if not exists demo.story (tbl text not null, id uuid not null, primary key (tbl, id));

create or replace function demo.at(p_day date, p_min int, p_tz text)
returns timestamptz language sql immutable as $$
  select ((p_day::timestamp + make_interval(mins => p_min)) at time zone p_tz)
$$;

create or replace function demo.refresh()
returns text
language plpgsql
set search_path = ''
as $$
declare
  st record;
  w record;
  d date;
  v_today date;
  v_now timestamptz := now();
  v_shift int;
  v_in timestamptz; v_bs timestamptz; v_be timestamptz; v_out timestamptz;
  v_week date; v_sheet uuid; v_hours numeric;
  v_events int := 0; v_sheets int := 0;
begin
  select * into st from demo.state where id = 1;
  if st is null then return 'demo not seeded'; end if;

  -- 1. Move the fixed story forward by whole days.
  v_shift := current_date - st.anchor;
  if v_shift > 0 then
    alter table public.leave_requests disable trigger audit_leave_requests;
    alter table public.expenses disable trigger audit_expenses;
    alter table public.announcements disable trigger audit_announcements;
    update public.tasks t set due_date = t.due_date + v_shift, created_at = t.created_at + make_interval(days => v_shift),
      completed_at = t.completed_at + make_interval(days => v_shift), outcome_at = t.outcome_at + make_interval(days => v_shift)
      where t.id in (select id from demo.story where tbl = 'tasks');
    update public.task_comments c set created_at = c.created_at + make_interval(days => v_shift)
      where c.id in (select id from demo.story where tbl = 'task_comments');
    update public.leave_requests l set start_date = l.start_date + v_shift, end_date = l.end_date + v_shift,
      created_at = l.created_at + make_interval(days => v_shift), reviewed_at = l.reviewed_at + make_interval(days => v_shift)
      where l.id in (select id from demo.story where tbl = 'leave_requests');
    update public.expenses e set expense_date = e.expense_date + v_shift, fx_date = e.fx_date + v_shift,
      created_at = e.created_at + make_interval(days => v_shift), submitted_at = e.submitted_at + make_interval(days => v_shift),
      reviewed_at = e.reviewed_at + make_interval(days => v_shift), reimbursed_at = e.reimbursed_at + make_interval(days => v_shift)
      where e.id in (select id from demo.story where tbl = 'expenses');
    update public.announcements a set published_at = a.published_at + make_interval(days => v_shift)
      where a.id in (select id from demo.story where tbl = 'announcements');
    update public.messages m set created_at = m.created_at + make_interval(days => v_shift)
      where m.id in (select id from demo.story where tbl = 'messages');
    update public.conversations c set last_message_at = c.last_message_at + make_interval(days => v_shift)
      where c.id in (select id from demo.story where tbl = 'conversations');
    update public.notifications n set created_at = n.created_at + make_interval(days => v_shift),
      read_at = n.read_at + make_interval(days => v_shift)
      where n.id in (select id from demo.story where tbl = 'notifications');
    update public.calendar_broadcasts b set starts_at = b.starts_at + make_interval(days => v_shift),
      ends_at = b.ends_at + make_interval(days => v_shift), created_at = b.created_at + make_interval(days => v_shift)
      where b.id in (select id from demo.story where tbl = 'calendar_broadcasts');
    update public.projects p set start_date = p.start_date + v_shift, end_date = p.end_date + v_shift
      where p.id in (select id from demo.story where tbl = 'projects');
    alter table public.leave_requests enable trigger audit_leave_requests;
    alter table public.expenses enable trigger audit_expenses;
    alter table public.announcements enable trigger audit_announcements;
    update demo.state set anchor = current_date where id = 1;
  end if;

  -- 2. Clock-ins: every working day since the start, up to the current local time.
  alter table public.attendance_events disable trigger attendance_mgmt_clock;
  alter table public.attendance_events disable trigger audit_attendance_events;
  for w in select * from demo.workers loop
    v_today := (v_now at time zone w.tz)::date;
    d := greatest(st.started, v_today - 28);
    while d <= v_today loop
      if extract(isodow from d) < 6
         and not exists (select 1 from public.public_holidays h where h.organization_id = w.organization_id and h.holiday_date = d)
         and not exists (select 1 from public.leave_requests l where l.membership_id = w.membership_id and l.status = 'approved'
                         and d between l.start_date and l.end_date) then
        v_in := demo.at(d, w.in_min + abs(hashtext(w.membership_id::text || d)) % 25, w.tz);
        v_bs := demo.at(d, 750 + abs(hashtext(d || w.membership_id::text)) % 20, w.tz);
        v_be := v_bs + make_interval(mins => w.break_min);
        v_out := demo.at(d, w.out_min + abs(hashtext(w.user_id::text || d)) % 40, w.tz);
        if v_in <= v_now and not exists (select 1 from public.attendance_events a where a.membership_id = w.membership_id and a.kind = 'clock_in'
            and a.occurred_at >= demo.at(d, 0, w.tz) and a.occurred_at < demo.at(d + 1, 0, w.tz)) then
          insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, project_id, created_by)
          values (w.organization_id, w.membership_id, 'clock_in', v_in, 'app', w.project_id, w.user_id);
          v_events := v_events + 1;
        end if;
        if exists (select 1 from public.attendance_events a where a.membership_id = w.membership_id and a.kind = 'clock_in'
            and a.occurred_at >= demo.at(d, 0, w.tz) and a.occurred_at < demo.at(d + 1, 0, w.tz) and a.source = 'app' and a.created_by = w.user_id) then
          if v_bs <= v_now and not exists (select 1 from public.attendance_events a where a.membership_id = w.membership_id and a.kind = 'break_start'
              and a.occurred_at >= demo.at(d, 0, w.tz) and a.occurred_at < demo.at(d + 1, 0, w.tz)) then
            insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
            values (w.organization_id, w.membership_id, 'break_start', v_bs, 'app', w.user_id);
            v_events := v_events + 1;
          end if;
          if v_be <= v_now and not exists (select 1 from public.attendance_events a where a.membership_id = w.membership_id and a.kind = 'break_end'
              and a.occurred_at >= demo.at(d, 0, w.tz) and a.occurred_at < demo.at(d + 1, 0, w.tz)) then
            insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
            values (w.organization_id, w.membership_id, 'break_end', v_be, 'app', w.user_id);
            v_events := v_events + 1;
          end if;
          if v_out <= v_now and not exists (select 1 from public.attendance_events a where a.membership_id = w.membership_id and a.kind = 'clock_out'
              and a.occurred_at >= demo.at(d, 0, w.tz) and a.occurred_at < demo.at(d + 1, 0, w.tz)) then
            insert into public.attendance_events (organization_id, membership_id, kind, occurred_at, source, created_by)
            values (w.organization_id, w.membership_id, 'clock_out', v_out, 'app', w.user_id);
            v_events := v_events + 1;
          end if;
        end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  alter table public.attendance_events enable trigger attendance_mgmt_clock;
  alter table public.attendance_events enable trigger audit_attendance_events;

  -- 3. Timesheets from the clock-ins: one per person and week; last week waits for approval,
  --    earlier weeks are approved by the person's manager.
  for w in select * from demo.workers loop
    v_today := (v_now at time zone w.tz)::date;
    v_week := st.started - (extract(isodow from st.started)::int - 1);
    while v_week <= v_today loop
      select id into v_sheet from public.timesheets where membership_id = w.membership_id and week_start = v_week;
      if v_sheet is null then
        insert into public.timesheets (organization_id, membership_id, week_start, status)
        values (w.organization_id, w.membership_id, v_week, 'draft') returning id into v_sheet;
        v_sheets := v_sheets + 1;
      end if;
      d := v_week;
      while d < least(v_week + 7, v_today) loop
        select round(sum(extract(epoch from (coalesce(o.occurred_at, i.occurred_at) - i.occurred_at)) / 3600.0
                 - coalesce((select extract(epoch from (be.occurred_at - bs.occurred_at)) / 3600.0
                             from public.attendance_events bs join public.attendance_events be on be.membership_id = bs.membership_id and be.kind = 'break_end'
                               and be.occurred_at > bs.occurred_at and be.occurred_at < demo.at(d + 1, 0, w.tz)
                             where bs.membership_id = w.membership_id and bs.kind = 'break_start'
                               and bs.occurred_at >= demo.at(d, 0, w.tz) and bs.occurred_at < demo.at(d + 1, 0, w.tz) limit 1), 0)), 2)
          into v_hours
        from public.attendance_events i
        left join lateral (select occurred_at from public.attendance_events x where x.membership_id = i.membership_id and x.kind = 'clock_out'
                           and x.occurred_at > i.occurred_at and x.occurred_at < demo.at(d + 1, 0, w.tz) order by occurred_at limit 1) o on true
        where i.membership_id = w.membership_id and i.kind = 'clock_in'
          and i.occurred_at >= demo.at(d, 0, w.tz) and i.occurred_at < demo.at(d + 1, 0, w.tz) and o.occurred_at is not null;
        if coalesce(v_hours, 0) > 0 and not exists (select 1 from public.timesheet_entries e where e.timesheet_id = v_sheet and e.work_date = d and e.from_clock) then
          insert into public.timesheet_entries (organization_id, timesheet_id, work_date, project_id, hours, category, from_clock, description, billable)
          values (w.organization_id, v_sheet, d, w.project_id, v_hours, 'work', true, 'From clock-ins', true);
        end if;
        d := d + 1;
      end loop;
      if v_week + 7 <= v_today - (extract(isodow from v_today)::int - 1) then
        -- A finished week.
        if v_week + 7 = v_today - (extract(isodow from v_today)::int - 1) then
          update public.timesheets set status = 'submitted', submitted_at = demo.at(v_week + 7, 9 * 60 + abs(hashtext(w.membership_id::text)) % 50, w.tz)
          where id = v_sheet and status = 'draft';
        else
          update public.timesheets set status = 'approved', submitted_at = coalesce(submitted_at, demo.at(v_week + 7, 540, w.tz)),
            reviewed_by = w.reviewer, reviewed_at = demo.at(v_week + 8, 600 + abs(hashtext(w.user_id::text)) % 90, w.tz)
          where id = v_sheet and status in ('draft', 'submitted');
        end if;
      end if;
      v_week := v_week + 7;
    end loop;
  end loop;

  -- 4. Shifts for this week and next.
  for w in select * from demo.workers loop
    v_today := (v_now at time zone w.tz)::date;
    d := v_today - (extract(isodow from v_today)::int - 1);
    while d < v_today - (extract(isodow from v_today)::int - 1) + 14 loop
      if extract(isodow from d) < 6 and not exists (select 1 from public.shifts s where s.membership_id = w.membership_id
          and s.starts_at >= demo.at(d, 0, w.tz) and s.starts_at < demo.at(d + 1, 0, w.tz)) then
        insert into public.shifts (organization_id, membership_id, starts_at, ends_at, break_minutes, location, project_id, created_by)
        values (w.organization_id, w.membership_id, demo.at(d, w.in_min, w.tz), demo.at(d, w.out_min + 15, w.tz), w.break_min, w.site, w.project_id, w.reviewer);
      end if;
      d := d + 1;
    end loop;
  end loop;

  return format('shifted %s day(s), %s clock events, %s new timesheets', greatest(v_shift, 0), v_events, v_sheets);
end;
$$;

revoke all on function demo.refresh() from public, anon, authenticated;
