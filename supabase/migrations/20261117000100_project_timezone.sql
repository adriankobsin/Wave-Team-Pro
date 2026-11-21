-- Each project has its own time zone (where the work is), so clock times show in the project's
-- local time: Thailand projects in Bangkok time, Singapore in Singapore time, Europe in European time.
alter table public.projects add column if not exists timezone text;

drop trigger if exists projects_validate_timezone on public.projects;
create trigger projects_validate_timezone before insert or update on public.projects
  for each row execute function public.validate_timezone_column();

-- Backfill from the site and country; anything unknown follows its company.
update public.projects p set timezone = case
  when p.site_label ilike '%singapore%' or p.country = 'SG' then 'Asia/Singapore'
  when p.site_label ilike '%phnom penh%' or p.country = 'KH' then 'Asia/Phnom_Penh'
  when p.site_label ~* '(bangkok|pattaya|phuket|thailand)' or p.country = 'TH' then 'Asia/Bangkok'
  when p.site_label ~* '(france|la ciotat|antibes)' or p.country = 'FR' then 'Europe/Paris'
  when p.site_label ~* '(spain|vigo)' or p.country = 'ES' then 'Europe/Madrid'
  when p.country = 'NL' then 'Europe/Amsterdam'
  when p.country = 'GB' then 'Europe/London'
  else (select o.timezone from public.organizations o where o.id = p.organization_id)
end
where p.timezone is null;

-- Management notifications show the time in the project's zone (company zone without a project).
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
    select coalesce(code || ' ', '') || name, coalesce(timezone, v_tz) into v_project, v_tz from public.projects where id = new.project_id;
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

-- A new project without a zone follows its company until someone sets it.
create or replace function public.project_default_timezone()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.timezone is null then
    select timezone into new.timezone from public.organizations where id = new.organization_id;
  end if;
  return new;
end;
$$;
drop trigger if exists projects_default_timezone on public.projects;
create trigger projects_default_timezone before insert on public.projects
  for each row execute function public.project_default_timezone();
