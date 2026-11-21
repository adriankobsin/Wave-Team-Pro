-- SharePoint filing: each company's receipts, expense workbooks, Xero files, timesheets and
-- reports are copied into a folder structure in Microsoft SharePoint. The app only ever adds
-- files (never deletes or overwrites). Work goes through a durable queue so a Microsoft outage
-- just delays uploads.

create table public.sharepoint_settings (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  enabled boolean not null default false,
  site_url text check (site_url is null or site_url ~ '^https://[a-z0-9-]+\.sharepoint\.com(/.*)?$'),
  library text not null default 'Documents' check (char_length(library) between 1 and 120),
  root_folder text not null default 'Wave Team Pro/{company}' check (char_length(root_folder) between 1 and 300),
  -- Per file kind: { "receipt": "pattern", ... }. Missing keys use the built-in defaults.
  templates jsonb not null default '{}'::jsonb check (jsonb_typeof(templates) = 'object'),
  disabled_kinds text[] not null default '{}',
  site_id text,
  drive_id text,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.sharepoint_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null check (kind in ('receipt', 'expense_month', 'xero_bills', 'xero_card', 'weekly_timesheets',
                                     'employee_timesheet', 'weekly_report', 'monthly_report', 'leave_register')),
  ref_key text not null check (char_length(ref_key) between 1 and 200),
  ref jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'done', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  path text,
  web_url text,
  size_bytes bigint,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, kind, ref_key)
);

create index sharepoint_uploads_queue_idx on public.sharepoint_uploads (status, next_attempt_at);
create index sharepoint_uploads_org_idx on public.sharepoint_uploads (organization_id, created_at desc);

alter table public.sharepoint_settings enable row level security;
alter table public.sharepoint_uploads enable row level security;

-- Settings: admins edit; finance can read (to see where files go). Microsoft ids are written by the server.
grant select, insert on public.sharepoint_settings to authenticated;
grant update (enabled, site_url, library, root_folder, templates, disabled_kinds, updated_at) on public.sharepoint_settings to authenticated;
create policy sps_select on public.sharepoint_settings for select to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage') or public.is_finance(organization_id));
create policy sps_insert on public.sharepoint_settings for insert to authenticated
  with check (public.has_permission(organization_id, 'org.settings.manage'));
create policy sps_update on public.sharepoint_settings for update to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage'))
  with check (public.has_permission(organization_id, 'org.settings.manage'));

-- Upload log: readable by admins and finance; written only by the server (service role) and triggers.
grant select on public.sharepoint_uploads to authenticated;
create policy spu_select on public.sharepoint_uploads for select to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage') or public.is_finance(organization_id));

create trigger audit_sharepoint_settings after insert or update on public.sharepoint_settings
  for each row execute function public.audit_row_change('organization_id');

-- Queue a file for an organization when filing is switched on and that kind isn't turned off.
create or replace function public.sharepoint_enqueue(p_org uuid, p_kind text, p_ref_key text, p_ref jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.sharepoint_settings s
             where s.organization_id = p_org and s.enabled and not (p_kind = any (s.disabled_kinds))) then
    insert into public.sharepoint_uploads (organization_id, kind, ref_key, ref)
    values (p_org, p_kind, p_ref_key, coalesce(p_ref, '{}'::jsonb))
    on conflict (organization_id, kind, ref_key) do nothing;
  end if;
end;
$$;

revoke all on function public.sharepoint_enqueue(uuid, text, text, jsonb) from public, anon, authenticated;

-- Admins/finance can put a failed upload back in the queue.
create or replace function public.sharepoint_retry(p_upload uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.sharepoint_uploads where id = p_upload;
  if v_org is null or not (public.has_permission(v_org, 'org.settings.manage') or public.is_finance(v_org)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.sharepoint_uploads
     set status = 'pending', next_attempt_at = now(), attempts = 0, last_error = null
   where id = p_upload and status in ('failed', 'skipped');
end;
$$;

revoke all on function public.sharepoint_retry(uuid) from public, anon;
grant execute on function public.sharepoint_retry(uuid) to authenticated;

-- Events -----------------------------------------------------------------------

-- Approved expense: each receipt file. A later re-approval files a new version.
create or replace function public.sp_on_expense_approved()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  f record;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for f in select id from public.files where context_type = 'expense' and context_id = new.id order by created_at loop
      perform public.sharepoint_enqueue(new.organization_id, 'receipt',
        f.id::text || '@' || to_char(coalesce(new.reviewed_at, now()), 'YYYYMMDDHH24MISSUS'),
        jsonb_build_object('expense_id', new.id, 'file_id', f.id));
    end loop;
  end if;
  return null;
end;
$$;

create trigger expenses_sharepoint after update on public.expenses
  for each row execute function public.sp_on_expense_approved();

-- Approved timesheet: the employee's own weekly sheet.
create or replace function public.sp_on_timesheet_approved()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.sharepoint_enqueue(new.organization_id, 'employee_timesheet',
      new.id::text || '@' || to_char(coalesce(new.reviewed_at, now()), 'YYYYMMDDHH24MISSUS'),
      jsonb_build_object('timesheet_id', new.id, 'membership_id', new.membership_id, 'week_start', new.week_start));
  end if;
  return null;
end;
$$;

create trigger timesheets_sharepoint after update on public.timesheets
  for each row execute function public.sp_on_timesheet_approved();

-- Month closed in Bookkeeping: the month's expense workbook.
create or replace function public.sp_on_period_closed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.reopened_at is null and (tg_op = 'INSERT' or old.reopened_at is not null or old.closed_at is distinct from new.closed_at) then
    perform public.sharepoint_enqueue(new.organization_id, 'expense_month',
      to_char(new.month, 'YYYY-MM') || '@' || to_char(new.closed_at, 'YYYYMMDDHH24MISSUS'),
      jsonb_build_object('month', to_char(new.month, 'YYYY-MM')));
  end if;
  return null;
end;
$$;

create trigger accounting_periods_sharepoint after insert or update on public.accounting_periods
  for each row execute function public.sp_on_period_closed();

-- Xero export marked as done: the exported CSV.
create or replace function public.sp_on_accounting_export()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.sharepoint_enqueue(new.organization_id, new.kind, new.id::text,
    jsonb_build_object('export_id', new.id, 'filters', new.filters));
  return null;
end;
$$;

create trigger accounting_exports_sharepoint after insert on public.accounting_exports
  for each row execute function public.sp_on_accounting_export();

revoke all on function public.sp_on_expense_approved() from public, anon, authenticated;
revoke all on function public.sp_on_timesheet_approved() from public, anon, authenticated;
revoke all on function public.sp_on_period_closed() from public, anon, authenticated;
revoke all on function public.sp_on_accounting_export() from public, anon, authenticated;

-- The server (service role) schedules weekly and monthly files through the same function.
grant execute on function public.sharepoint_enqueue(uuid, text, text, jsonb) to service_role;
