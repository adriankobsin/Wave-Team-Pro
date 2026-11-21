-- Phase D: receipts and expense claims (internal bookkeeping only; merchants are text, not supplier records).

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  accounting_code text check (accounting_code is null or char_length(accounting_code) <= 32),
  receipt_required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

-- Rates are entered by bookkeepers with their source; nothing is fetched or guessed.
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  from_currency char(3) not null check (from_currency ~ '^[A-Z]{3}$'),
  to_currency char(3) not null check (to_currency ~ '^[A-Z]{3}$'),
  rate numeric(18, 8) not null check (rate > 0),
  rate_date date not null,
  source text not null check (char_length(btrim(source)) between 2 and 120),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (from_currency <> to_currency),
  unique (organization_id, from_currency, to_currency, rate_date)
);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  membership_id uuid not null,
  project_id uuid,
  category_id uuid,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  expense_date date,
  merchant text check (merchant is null or char_length(merchant) <= 200),
  reference text check (reference is null or char_length(reference) <= 100),
  tax_number text check (tax_number is null or char_length(tax_number) <= 60),
  description text check (description is null or char_length(description) <= 1000),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14, 2) check (subtotal is null or subtotal >= 0),
  tax_amount numeric(14, 2) check (tax_amount is null or tax_amount >= 0),
  tip_amount numeric(14, 2) check (tip_amount is null or tip_amount >= 0),
  total numeric(14, 2) check (total is null or total >= 0),
  payment_method text not null default 'personal' check (payment_method in ('personal', 'company_card', 'cash', 'other')),
  reimbursable boolean not null default true,
  no_receipt_reason text check (no_receipt_reason is null or char_length(no_receipt_reason) <= 300),
  -- Reporting currency conversion (organization base currency), set on submit and approval.
  reporting_currency char(3),
  fx_rate numeric(18, 8),
  fx_date date,
  fx_source text,
  reporting_total numeric(14, 2),
  extraction_status text not null default 'none' check (extraction_status in ('none', 'pending', 'processing', 'done', 'failed', 'skipped')),
  duplicate_of uuid,
  duplicate_override boolean not null default false,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reimbursement_status text not null default 'not_required' check (reimbursement_status in ('not_required', 'pending', 'paid')),
  reimbursed_at timestamptz,
  reimbursed_by uuid references public.profiles (id),
  reimbursement_reference text check (reimbursement_reference is null or char_length(reimbursement_reference) <= 100),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete restrict,
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete restrict,
  foreign key (category_id, organization_id) references public.expense_categories (id, organization_id) on delete restrict
);

create index expenses_org_member_date_idx on public.expenses (organization_id, membership_id, expense_date);
create index expenses_org_status_idx on public.expenses (organization_id, status, expense_date);
create index expenses_project_idx on public.expenses (project_id);
create trigger expenses_updated_at before update on public.expenses for each row execute function public.set_updated_at();

-- Raw extraction output is kept separately from the editable expense.
create table public.expense_ai_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  expense_id uuid not null,
  file_id uuid not null references public.files (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  provider text,
  model text,
  attempts integer not null default 0,
  result jsonb,
  error text check (error is null or char_length(error) <= 500),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (file_id),
  foreign key (expense_id, organization_id) references public.expenses (id, organization_id) on delete cascade
);

create index expense_extractions_expense_idx on public.expense_ai_extractions (expense_id);

-- Immutable status history and approval trail.
create table public.expense_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  expense_id uuid not null,
  actor_id uuid references public.profiles (id),
  event text not null check (event in ('created', 'submitted', 'approved', 'rejected', 'cancelled', 'corrected', 'reimbursed', 'extracted', 'duplicate_override')),
  note text check (note is null or char_length(note) <= 500),
  changes jsonb,
  created_at timestamptz not null default now(),
  foreign key (expense_id, organization_id) references public.expenses (id, organization_id) on delete cascade
);

create index expense_events_expense_idx on public.expense_events (expense_id, created_at);

create or replace function public.prevent_change()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'This history is append-only' using errcode = '42501'; end; $$;

create trigger expense_events_immutable before update or delete on public.expense_events
  for each row execute function public.prevent_change();

create table public.expense_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_id uuid not null references public.profiles (id),
  format text not null check (format in ('xlsx', 'zip')),
  filters jsonb not null default '{}'::jsonb,
  row_count integer not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

create or replace function public.can_review_expense_row(p_org uuid, p_membership uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_membership is distinct from public.my_membership_id(p_org) and (
    public.can_supervise(p_org, 'expenses.approve', p_membership)
    or (p_project is not null and public.has_permission(p_org, 'expenses.approve', 'project', p_project))
  );
$$;

create or replace function public.can_view_expense_row(p_org uuid, p_membership uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_org_member(p_org) and (
    p_membership = public.my_membership_id(p_org)
    or public.has_permission(p_org, 'expenses.view.all')
    or public.can_supervise(p_org, 'expenses.view.team', p_membership)
    or (p_project is not null and public.has_permission(p_org, 'expenses.view.team', 'project', p_project))
    or public.can_review_expense_row(p_org, p_membership, p_project)
    or public.has_permission(p_org, 'reimbursements.manage')
  );
$$;

create or replace function public.can_view_expense(p_expense uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.can_view_expense_row(organization_id, membership_id, project_id)
                   from public.expenses where id = p_expense), false);
$$;

create or replace function public.can_edit_expense(p_expense uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.expenses e where e.id = p_expense and e.status in ('draft', 'rejected')
                 and e.membership_id = public.my_membership_id(e.organization_id));
$$;

-- Expense receipts are readable by anyone who can see the expense.
create or replace function public.can_read_file(p_file uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  f record;
begin
  select * into f from public.files where id = p_file;
  if not found or not public.is_org_member(f.organization_id) then return false; end if;
  if f.context_type = 'message' then
    return exists (select 1 from public.messages m where m.id = f.context_id and m.deleted_at is null
                   and public.can_read_conversation(m.conversation_id));
  elsif f.context_type = 'document' then
    return exists (select 1 from public.documents d where d.id = f.context_id and public.can_read_folder(d.folder_id));
  elsif f.context_type = 'announcement' then
    return public.can_read_announcement(f.context_id);
  elsif f.context_type = 'task' then
    return public.can_view_task(f.context_id);
  elsif f.context_type = 'expense' then
    return public.can_view_expense(f.context_id);
  end if;
  return false;
end;
$$;

-- Owners may edit draft/rejected claims directly; everything else goes through functions.
create or replace function public.guard_expense()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.membership_id is distinct from public.my_membership_id(new.organization_id)
       or not public.has_permission(new.organization_id, 'expenses.create') then
      raise exception 'You can only create your own expenses' using errcode = '42501';
    end if;
    new.status := 'draft';
    new.created_by := auth.uid();
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    new.reimbursement_status := 'not_required'; new.reimbursed_at := null; new.reimbursed_by := null;
    new.reporting_currency := null; new.fx_rate := null; new.fx_date := null; new.fx_source := null; new.reporting_total := null;
    new.duplicate_of := null; new.duplicate_override := false; new.submitted_at := null;
  else
    if old.status not in ('draft', 'rejected') then
      raise exception 'Submitted expenses can no longer be edited' using errcode = '42501';
    end if;
    if new.organization_id <> old.organization_id or new.membership_id <> old.membership_id
       or new.created_by <> old.created_by or new.status <> old.status
       or new.reviewed_by is distinct from old.reviewed_by or new.reimbursement_status <> old.reimbursement_status
       or new.fx_rate is distinct from old.fx_rate or new.reporting_total is distinct from old.reporting_total
       or new.duplicate_override <> old.duplicate_override or new.extraction_status <> old.extraction_status then
      raise exception 'Those fields are managed by the approval workflow' using errcode = '42501';
    end if;
  end if;
  if new.project_id is not null and not public.can_view_project(new.project_id) then
    raise exception 'You cannot charge expenses to that project' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger expenses_guard before insert or update on public.expenses
  for each row execute function public.guard_expense();

create or replace function public.log_expense_created()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.expense_events (organization_id, expense_id, actor_id, event)
  values (new.organization_id, new.id, auth.uid(), 'created');
  return null;
end;
$$;

create trigger expenses_log_created after insert on public.expenses
  for each row execute function public.log_expense_created();

-- ---------------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------------

-- Fills reporting-currency fields from the latest bookkeeper rate on or before the expense date.
create or replace function public.apply_expense_fx(p_expense uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_base char(3);
  r public.exchange_rates%rowtype;
begin
  select * into e from public.expenses where id = p_expense;
  select base_currency into v_base from public.organizations where id = e.organization_id;
  if e.total is null or e.currency is null then
    return;
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  if e.currency = v_base then
    update public.expenses set reporting_currency = v_base, fx_rate = 1, fx_date = e.expense_date,
      fx_source = 'Same currency', reporting_total = e.total where id = p_expense;
  else
    select * into r from public.exchange_rates
      where organization_id = e.organization_id and from_currency = e.currency and to_currency = v_base
        and rate_date <= coalesce(e.expense_date, current_date)
      order by rate_date desc limit 1;
    if found then
      -- Rounded half away from zero to 2 decimals.
      update public.expenses set reporting_currency = v_base, fx_rate = r.rate, fx_date = r.rate_date,
        fx_source = r.source, reporting_total = round(e.total * r.rate, 2) where id = p_expense;
    else
      update public.expenses set reporting_currency = v_base, fx_rate = null, fx_date = null,
        fx_source = null, reporting_total = null where id = p_expense;
    end if;
  end if;
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

-- Possible duplicates: same receipt file anywhere in the organization, or same person,
-- merchant (case-insensitive), date and total.
create or replace function public.expense_duplicates(p_expense uuid)
returns table (id uuid, reason text, status text)
language sql stable security definer set search_path = ''
as $$
  with me as (select * from public.expenses where id = p_expense and public.can_view_expense(p_expense)),
  my_hashes as (select f.sha256 from public.files f, me where f.context_type = 'expense' and f.context_id = me.id)
  select distinct on (o.id) o.id,
    case when exists (select 1 from public.files f2 where f2.context_type = 'expense' and f2.context_id = o.id
                      and f2.organization_id = o.organization_id and f2.sha256 in (select sha256 from my_hashes))
         then 'Same receipt file' else 'Same merchant, date and amount' end,
    o.status
  from public.expenses o, me
  where o.organization_id = me.organization_id and o.id <> me.id and o.status <> 'cancelled'
    and (
      exists (select 1 from public.files f2 where f2.context_type = 'expense' and f2.context_id = o.id
              and f2.organization_id = o.organization_id and f2.sha256 in (select sha256 from my_hashes))
      or (o.membership_id = me.membership_id and me.merchant is not null and me.expense_date is not null and me.total is not null
          and lower(btrim(o.merchant)) = lower(btrim(me.merchant)) and o.expense_date = me.expense_date and o.total = me.total)
    );
$$;

create or replace function public.submit_expense(p_id uuid, p_confirm_repeat boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  c public.expense_categories%rowtype;
  v_dup uuid;
  v_files integer;
  v_mgr uuid;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.membership_id <> public.my_membership_id(e.organization_id) then
    raise exception 'Expense not found' using errcode = '42501';
  end if;
  if e.status not in ('draft', 'rejected') then
    raise exception 'This expense has already been submitted' using errcode = '22023';
  end if;
  if e.expense_date is null or e.total is null or e.currency is null or e.category_id is null
     or nullif(btrim(coalesce(e.merchant, '')), '') is null or nullif(btrim(coalesce(e.description, '')), '') is null then
    raise exception 'Fill in date, merchant, category, currency, total and business purpose before submitting' using errcode = '22023';
  end if;
  if e.expense_date > current_date + 1 then
    raise exception 'The expense date is in the future' using errcode = '22023';
  end if;
  select * into c from public.expense_categories where id = e.category_id;
  select count(*) into v_files from public.files where context_type = 'expense' and context_id = p_id;
  if c.receipt_required and v_files = 0 and nullif(btrim(coalesce(e.no_receipt_reason, '')), '') is null then
    raise exception '% needs a receipt, or explain why there is none', c.name using errcode = '22023';
  end if;
  select d.id into v_dup from public.expense_duplicates(p_id) d limit 1;
  if v_dup is not null and not p_confirm_repeat then
    raise exception 'DUPLICATE: This looks like an expense that already exists. Confirm it is a separate purchase to submit.' using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses
    set status = 'submitted', submitted_at = now(), reviewed_by = null, reviewed_at = null, review_note = null,
        duplicate_of = v_dup, duplicate_override = (v_dup is not null),
        reimbursement_status = case when reimbursable and payment_method in ('personal', 'cash') then 'pending' else 'not_required' end
    where id = p_id;
  insert into public.expense_events (organization_id, expense_id, actor_id, event)
  values (e.organization_id, p_id, auth.uid(), 'submitted');
  if v_dup is not null then
    insert into public.expense_events (organization_id, expense_id, actor_id, event, note)
    values (e.organization_id, p_id, auth.uid(), 'duplicate_override', 'Submitter confirmed this is a separate purchase');
  end if;
  perform set_config('wbh.trusted_op', 'off', true);
  perform public.apply_expense_fx(p_id);
  select m2.user_id into v_mgr from public.organization_memberships m
    join public.organization_memberships m2 on m2.id = m.manager_membership_id where m.id = e.membership_id;
  perform public.notify(e.organization_id, v_mgr, 'expense',
    public.display_name_of(auth.uid()) || ' submitted an expense',
    e.merchant || ' · ' || e.currency || ' ' || to_char(e.total, 'FM999G999G990D00'),
    '/o/' || public.org_slug(e.organization_id) || '/expenses/' || p_id);
end;
$$;

create or replace function public.review_expense(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.status <> 'submitted' then
    raise exception 'This expense is not waiting for review' using errcode = '22023';
  end if;
  if not public.can_review_expense_row(e.organization_id, e.membership_id, e.project_id) then
    raise exception 'You cannot approve this expense' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Explain what needs to change when rejecting' using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), ''),
        reimbursement_status = case when p_approve then reimbursement_status else 'not_required' end
    where id = p_id;
  insert into public.expense_events (organization_id, expense_id, actor_id, event, note)
  values (e.organization_id, p_id, auth.uid(), case when p_approve then 'approved' else 'rejected' end,
          nullif(btrim(coalesce(p_note, '')), ''));
  perform set_config('wbh.trusted_op', 'off', true);
  if p_approve then
    perform public.apply_expense_fx(p_id);
  end if;
  perform public.notify(e.organization_id, public.membership_user_of(e.membership_id), 'expense',
    'Expense ' || case when p_approve then 'approved' else 'returned for changes' end,
    coalesce(e.merchant, 'Expense') || coalesce(': ' || p_note, ''),
    '/o/' || public.org_slug(e.organization_id) || '/expenses/' || p_id);
end;
$$;

-- Reviewer corrections before approval; every change is recorded with old and new values.
create or replace function public.correct_expense(
  p_id uuid, p_category uuid, p_project uuid, p_expense_date date, p_merchant text,
  p_currency text, p_subtotal numeric, p_tax numeric, p_total numeric, p_note text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_changes jsonb := '{}'::jsonb;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.status <> 'submitted' then
    raise exception 'Only submitted expenses can be corrected' using errcode = '22023';
  end if;
  if not public.can_review_expense_row(e.organization_id, e.membership_id, e.project_id) then
    raise exception 'You cannot correct this expense' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why you are correcting it' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from public.expense_categories where id = p_category and organization_id = e.organization_id) then
    raise exception 'Unknown category' using errcode = '22023';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and organization_id = e.organization_id) then
    raise exception 'Unknown project' using errcode = '22023';
  end if;
  if p_category is distinct from e.category_id then v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_array(e.category_id, p_category)); end if;
  if p_project is distinct from e.project_id then v_changes := v_changes || jsonb_build_object('project_id', jsonb_build_array(e.project_id, p_project)); end if;
  if p_expense_date is distinct from e.expense_date then v_changes := v_changes || jsonb_build_object('expense_date', jsonb_build_array(e.expense_date, p_expense_date)); end if;
  if p_merchant is distinct from e.merchant then v_changes := v_changes || jsonb_build_object('merchant', jsonb_build_array(e.merchant, p_merchant)); end if;
  if p_currency is distinct from e.currency::text then v_changes := v_changes || jsonb_build_object('currency', jsonb_build_array(e.currency, p_currency)); end if;
  if p_subtotal is distinct from e.subtotal then v_changes := v_changes || jsonb_build_object('subtotal', jsonb_build_array(e.subtotal, p_subtotal)); end if;
  if p_tax is distinct from e.tax_amount then v_changes := v_changes || jsonb_build_object('tax_amount', jsonb_build_array(e.tax_amount, p_tax)); end if;
  if p_total is distinct from e.total then v_changes := v_changes || jsonb_build_object('total', jsonb_build_array(e.total, p_total)); end if;
  if v_changes = '{}'::jsonb then
    return;
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses set category_id = p_category, project_id = p_project, expense_date = p_expense_date,
    merchant = p_merchant, currency = p_currency, subtotal = p_subtotal, tax_amount = p_tax, total = p_total
    where id = p_id;
  insert into public.expense_events (organization_id, expense_id, actor_id, event, note, changes)
  values (e.organization_id, p_id, auth.uid(), 'corrected', left(btrim(p_note), 500), v_changes);
  perform set_config('wbh.trusted_op', 'off', true);
  perform public.apply_expense_fx(p_id);
  perform public.notify(e.organization_id, public.membership_user_of(e.membership_id), 'expense',
    'Your expense was corrected by a reviewer', p_note,
    '/o/' || public.org_slug(e.organization_id) || '/expenses/' || p_id);
end;
$$;

create or replace function public.cancel_expense(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.membership_id <> public.my_membership_id(e.organization_id) then
    raise exception 'Expense not found' using errcode = '42501';
  end if;
  if e.status not in ('draft', 'rejected', 'submitted') then
    raise exception 'Approved expenses cannot be withdrawn; ask a bookkeeper' using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses set status = 'cancelled', reimbursement_status = 'not_required' where id = p_id;
  insert into public.expense_events (organization_id, expense_id, actor_id, event)
  values (e.organization_id, p_id, auth.uid(), 'cancelled');
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

create or replace function public.mark_expenses_reimbursed(p_org uuid, p_ids uuid[], p_reference text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  if not public.has_permission(p_org, 'reimbursements.manage') then
    raise exception 'reimbursements.manage permission required' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  for r in
    update public.expenses set reimbursement_status = 'paid', reimbursed_at = now(), reimbursed_by = auth.uid(),
      reimbursement_reference = nullif(left(btrim(coalesce(p_reference, '')), 100), '')
    where organization_id = p_org and id = any (p_ids) and status = 'approved' and reimbursement_status = 'pending'
      and membership_id <> public.my_membership_id(p_org)
    returning id, membership_id, merchant
  loop
    v_count := v_count + 1;
    insert into public.expense_events (organization_id, expense_id, actor_id, event, note)
    values (p_org, r.id, auth.uid(), 'reimbursed', nullif(left(btrim(coalesce(p_reference, '')), 500), ''));
    perform public.notify(p_org, public.membership_user_of(r.membership_id), 'expense', 'Expense reimbursed',
      r.merchant, '/o/' || public.org_slug(p_org) || '/expenses/' || r.id);
  end loop;
  perform set_config('wbh.trusted_op', 'off', true);
  return v_count;
end;
$$;

create or replace function public.log_expense_export(p_org uuid, p_format text, p_filters jsonb, p_rows integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_permission(p_org, 'expenses.export') then
    raise exception 'expenses.export permission required' using errcode = '42501';
  end if;
  insert into public.expense_exports (organization_id, actor_id, format, filters, row_count)
  values (p_org, auth.uid(), p_format, coalesce(p_filters, '{}'::jsonb), p_rows);
end;
$$;

-- Expense approvals waiting for the current user (kept separate so existing functions stay unchanged).
create or replace function public.my_expense_approval_count(p_org uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from public.expenses e where e.organization_id = p_org and e.status = 'submitted'
     and public.can_review_expense_row(p_org, e.membership_id, e.project_id);
$$;

create or replace function public.my_pending_approvals(p_org uuid)
returns table (kind text, id uuid)
language sql stable security definer set search_path = ''
as $$
  select 'timesheet', t.id from public.timesheets t where t.organization_id = p_org and t.status = 'submitted'
     and public.can_supervise(p_org, 'timesheets.approve', t.membership_id)
  union all
  select 'leave', r.id from public.leave_requests r where r.organization_id = p_org and r.status = 'pending'
     and public.can_supervise(p_org, 'leave.approve', r.membership_id)
  union all
  select 'correction', c.id from public.attendance_corrections c where c.organization_id = p_org and c.status = 'pending'
     and (public.can_supervise(p_org, 'attendance.view.team', c.membership_id)
          or (public.has_permission(p_org, 'attendance.view.all') and c.membership_id <> public.my_membership_id(p_org)))
  union all
  select 'expense', e.id from public.expenses e where e.organization_id = p_org and e.status = 'submitted'
     and public.can_review_expense_row(p_org, e.membership_id, e.project_id);
$$;

-- Approved spend per project, kept per currency (never summed across currencies).
create or replace function public.project_expense_totals(p_project uuid)
returns table (currency text, total numeric, reporting_currency text, reporting_total numeric, unconverted integer)
language sql stable security definer set search_path = ''
as $$
  select e.currency::text, sum(e.total), max(e.reporting_currency)::text, sum(e.reporting_total),
         count(*) filter (where e.reporting_total is null)::integer
  from public.expenses e
  where e.project_id = p_project and e.status = 'approved' and public.can_view_project(p_project)
    and (public.has_permission(e.organization_id, 'expenses.view.all')
         or public.has_permission(e.organization_id, 'expenses.view.team', 'project', p_project)
         or public.can_edit_project(p_project))
  group by e.currency;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.expense_categories enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_ai_extractions enable row level security;
alter table public.expense_events enable row level security;
alter table public.expense_exports enable row level security;

grant select, insert on public.expense_categories to authenticated;
grant update (name, accounting_code, receipt_required, active) on public.expense_categories to authenticated;
create policy expense_categories_select on public.expense_categories for select to authenticated using (public.is_org_member(organization_id));
create policy expense_categories_insert on public.expense_categories for insert to authenticated
  with check (public.has_permission(organization_id, 'org.settings.manage') or public.has_permission(organization_id, 'expenses.export'));
create policy expense_categories_update on public.expense_categories for update to authenticated
  using (public.has_permission(organization_id, 'org.settings.manage') or public.has_permission(organization_id, 'expenses.export'))
  with check (public.has_permission(organization_id, 'org.settings.manage') or public.has_permission(organization_id, 'expenses.export'));

grant select, insert, delete on public.exchange_rates to authenticated;
create policy exchange_rates_select on public.exchange_rates for select to authenticated using (public.is_org_member(organization_id));
create policy exchange_rates_insert on public.exchange_rates for insert to authenticated
  with check (created_by = auth.uid() and (public.has_permission(organization_id, 'expenses.export') or public.has_permission(organization_id, 'reimbursements.manage')));
create policy exchange_rates_delete on public.exchange_rates for delete to authenticated
  using (public.has_permission(organization_id, 'expenses.export') or public.has_permission(organization_id, 'reimbursements.manage'));

grant select, insert on public.expenses to authenticated;
grant update (project_id, category_id, expense_date, merchant, reference, tax_number, description, currency, subtotal,
  tax_amount, tip_amount, total, payment_method, reimbursable, no_receipt_reason) on public.expenses to authenticated;
create policy expenses_select on public.expenses for select to authenticated
  using (public.can_view_expense_row(organization_id, membership_id, project_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (membership_id = public.my_membership_id(organization_id) and public.has_permission(organization_id, 'expenses.create'));
create policy expenses_update on public.expenses for update to authenticated
  using (status in ('draft', 'rejected') and membership_id = public.my_membership_id(organization_id))
  with check (membership_id = public.my_membership_id(organization_id));

grant select on public.expense_ai_extractions to authenticated;
create policy expense_extractions_select on public.expense_ai_extractions for select to authenticated
  using (public.can_view_expense(expense_id));

grant select on public.expense_events to authenticated;
create policy expense_events_select on public.expense_events for select to authenticated
  using (public.can_view_expense(expense_id));

grant select on public.expense_exports to authenticated;
create policy expense_exports_select on public.expense_exports for select to authenticated
  using (public.has_permission(organization_id, 'expenses.export'));

-- ---------------------------------------------------------------------------
-- Grants, audit, seeds, realtime
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.can_review_expense_row(uuid, uuid, uuid)', 'public.can_view_expense_row(uuid, uuid, uuid)',
    'public.can_view_expense(uuid)', 'public.can_edit_expense(uuid)', 'public.can_read_file(uuid)',
    'public.expense_duplicates(uuid)', 'public.submit_expense(uuid, boolean)', 'public.review_expense(uuid, boolean, text)',
    'public.correct_expense(uuid, uuid, uuid, date, text, text, numeric, numeric, numeric, text)',
    'public.cancel_expense(uuid)', 'public.mark_expenses_reimbursed(uuid, uuid[], text)',
    'public.log_expense_export(uuid, text, jsonb, integer)', 'public.my_expense_approval_count(uuid)',
    'public.my_pending_approvals(uuid)', 'public.project_expense_totals(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.apply_expense_fx(uuid) from public, anon, authenticated;
revoke all on function public.log_expense_created() from public, anon, authenticated;
revoke all on function public.prevent_change() from public, anon, authenticated;
revoke all on function public.guard_expense() from public, anon, authenticated;

create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.audit_row_change('id', 'description', 'no_receipt_reason');
create trigger audit_expense_categories after insert or update or delete on public.expense_categories
  for each row execute function public.audit_row_change();
create trigger audit_exchange_rates after insert or update or delete on public.exchange_rates
  for each row execute function public.audit_row_change();
create trigger audit_expense_exports after insert on public.expense_exports
  for each row execute function public.audit_row_change();

create or replace function public.seed_organization_expenses(p_org uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.expense_categories (organization_id, name, receipt_required)
  values (p_org, 'Travel', true), (p_org, 'Accommodation', true), (p_org, 'Meals', true),
         (p_org, 'Fuel & mileage', false), (p_org, 'Equipment & tools', true), (p_org, 'Materials', true),
         (p_org, 'Parking & tolls', false), (p_org, 'Software & subscriptions', true), (p_org, 'Other', true)
  on conflict (organization_id, name) do nothing;
end;
$$;

revoke all on function public.seed_organization_expenses(uuid) from public, anon, authenticated;

create or replace function public.seed_expenses_on_org()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform public.seed_organization_expenses(new.id); return null; end; $$;

revoke all on function public.seed_expenses_on_org() from public, anon, authenticated;

create trigger organizations_seed_expenses after insert on public.organizations
  for each row execute function public.seed_expenses_on_org();

select public.seed_organization_expenses(id) from public.organizations;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;

-- Attendance status is only visible to people who may see that person's time records.
create or replace function public.attendance_state(p_membership uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case when not public.can_view_time_of(public.membership_org(p_membership), p_membership) then null
    else case (select kind from public.attendance_events where membership_id = p_membership order by occurred_at desc, created_at desc limit 1)
      when 'clock_in' then 'in' when 'break_end' then 'in' when 'break_start' then 'break' else 'out' end end;
$$;
