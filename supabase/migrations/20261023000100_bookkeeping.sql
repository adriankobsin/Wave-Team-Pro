-- Bookkeeping: VAT rates, company cards and statement matching, month close, accounting export tracking.

-- ---------------------------------------------------------------------------
-- VAT / tax rates (names must match the tax rate names in the accounting system)
-- ---------------------------------------------------------------------------

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  rate numeric(5, 2) not null check (rate between 0 and 100),
  accounting_name text not null check (char_length(btrim(accounting_name)) between 1 and 80),
  reclaimable boolean not null default true,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

create table public.accounting_settings (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  bill_prefix text not null default 'EXP' check (bill_prefix ~ '^[A-Za-z0-9-]{1,12}$'),
  bill_due_days integer not null default 0 check (bill_due_days between 0 and 90),
  tracking_name text check (tracking_name is null or char_length(tracking_name) <= 40),
  default_account_code text check (default_account_code is null or char_length(default_account_code) <= 32),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Company cards and statements
-- ---------------------------------------------------------------------------

create table public.company_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  holder_membership_id uuid,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  account_code text check (account_code is null or char_length(account_code) <= 32),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (holder_membership_id, organization_id)
    references public.organization_memberships (id, organization_id) on delete set null (holder_membership_id)
);

create table public.card_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  card_id uuid not null,
  file_name text not null check (char_length(file_name) <= 200),
  row_count integer not null,
  skipped_count integer not null default 0,
  imported_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (card_id, organization_id) references public.company_cards (id, organization_id) on delete cascade
);

create table public.card_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  card_id uuid not null,
  import_id uuid,
  txn_date date not null,
  description text not null check (char_length(description) <= 300),
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reference text check (reference is null or char_length(reference) <= 100),
  fingerprint text not null,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  expense_id uuid,
  matched_by uuid references public.profiles (id),
  matched_at timestamptz,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (card_id, fingerprint),
  unique (id, organization_id),
  check ((status = 'matched') = (expense_id is not null)),
  foreign key (card_id, organization_id) references public.company_cards (id, organization_id) on delete cascade,
  foreign key (import_id, organization_id) references public.card_imports (id, organization_id) on delete set null (import_id),
  foreign key (expense_id, organization_id) references public.expenses (id, organization_id) on delete set null (expense_id)
);

create unique index card_transactions_expense_uidx on public.card_transactions (expense_id) where expense_id is not null;
create index card_transactions_card_date_idx on public.card_transactions (card_id, txn_date);
create index card_transactions_org_status_idx on public.card_transactions (organization_id, status, txn_date);

-- ---------------------------------------------------------------------------
-- Month close and accounting exports
-- ---------------------------------------------------------------------------

create table public.accounting_periods (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles (id),
  reopened_at timestamptz,
  reopened_by uuid references public.profiles (id),
  primary key (organization_id, month)
);

create table public.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null check (kind in ('xero_bills', 'xero_card')),
  actor_id uuid not null references public.profiles (id),
  row_count integer not null,
  filters jsonb not null default '{}'::jsonb,
  undone_at timestamptz,
  undone_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);

alter table public.expenses add column tax_rate_id uuid;
alter table public.expenses add column card_id uuid;
alter table public.expenses add column accounting_export_id uuid;
alter table public.expenses add column accounting_exported_at timestamptz;
alter table public.expenses add constraint expenses_tax_rate_fk
  foreign key (tax_rate_id, organization_id) references public.tax_rates (id, organization_id) on delete restrict;
alter table public.expenses add constraint expenses_card_fk
  foreign key (card_id, organization_id) references public.company_cards (id, organization_id) on delete restrict;
alter table public.expenses add constraint expenses_accounting_export_fk
  foreign key (accounting_export_id, organization_id) references public.accounting_exports (id, organization_id) on delete restrict;
create index expenses_export_idx on public.expenses (organization_id, accounting_export_id);

grant update (tax_rate_id, card_id) on public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers and guards
-- ---------------------------------------------------------------------------

create or replace function public.is_finance(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_permission(p_org, 'expenses.export') or public.has_permission(p_org, 'reimbursements.manage');
$$;

create or replace function public.period_closed(p_org uuid, p_date date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_date is not null and exists (
    select 1 from public.accounting_periods where organization_id = p_org and month = date_trunc('month', p_date)::date and reopened_at is null);
$$;

create or replace function public.can_see_card_row(p_org uuid, p_holder uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_org_member(p_org) and (public.is_finance(p_org) or p_holder = public.my_membership_id(p_org));
$$;

create or replace function public.can_see_card(p_card uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.company_cards c where c.id = p_card and public.is_org_member(c.organization_id)
    and (public.is_finance(c.organization_id) or c.holder_membership_id = public.my_membership_id(c.organization_id)));
$$;

-- Closed months, card and accounting-export rules, applied on top of guard_expense.
create or replace function public.guard_expense_bookkeeping()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
begin
  if v_service then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if public.period_closed(new.organization_id, new.expense_date) then
      raise exception 'The books for % are closed. Choose a later date or ask the bookkeeper to reopen the month.', to_char(new.expense_date, 'Mon YYYY') using errcode = '22023';
    end if;
  else
    if old.accounting_export_id is not null and not public.is_trusted_db_context()
       and (new.total is distinct from old.total or new.tax_amount is distinct from old.tax_amount or new.tax_rate_id is distinct from old.tax_rate_id
            or new.category_id is distinct from old.category_id or new.currency is distinct from old.currency) then
      raise exception 'This expense has been exported to accounting and can no longer be changed' using errcode = '42501';
    end if;
    if (new.expense_date is distinct from old.expense_date or (new.status = 'submitted' and old.status <> 'submitted')
        or new.total is distinct from old.total or new.tax_amount is distinct from old.tax_amount)
       and (public.period_closed(new.organization_id, new.expense_date) or public.period_closed(old.organization_id, old.expense_date)) then
      raise exception 'The books for % are closed. Ask the bookkeeper to reopen the month.', to_char(coalesce(new.expense_date, old.expense_date), 'Mon YYYY') using errcode = '22023';
    end if;
  end if;
  if new.card_id is not null and (tg_op = 'INSERT' or new.card_id is distinct from old.card_id) and not public.is_trusted_db_context()
     and not public.can_see_card(new.card_id) then
    raise exception 'You can only choose a company card you hold' using errcode = '42501';
  end if;
  if new.card_id is not null and new.payment_method <> 'company_card' then
    new.card_id := null;
  end if;
  return new;
end;
$$;

create trigger expenses_guard_bookkeeping before insert or update on public.expenses
  for each row execute function public.guard_expense_bookkeeping();

-- Finance coding of a submitted or approved claim (VAT code/amount, category, card).
create or replace function public.code_expense(p_id uuid, p_category uuid, p_tax_rate uuid, p_tax numeric, p_card uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_changes jsonb := '{}'::jsonb;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.status not in ('submitted', 'approved') then
    raise exception 'Only submitted or approved expenses can be coded' using errcode = '22023';
  end if;
  if not public.is_finance(e.organization_id) and not public.can_review_expense_row(e.organization_id, e.membership_id, e.project_id) then
    raise exception 'You cannot code this expense' using errcode = '42501';
  end if;
  if e.accounting_export_id is not null then
    raise exception 'Already exported to accounting. Undo the export first.' using errcode = '22023';
  end if;
  if public.period_closed(e.organization_id, e.expense_date) then
    raise exception 'The books for this month are closed' using errcode = '22023';
  end if;
  if p_tax is not null and (p_tax < 0 or (e.total is not null and p_tax > e.total)) then
    raise exception 'VAT must be between 0 and the total' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from public.expense_categories where id = p_category and organization_id = e.organization_id) then
    raise exception 'Unknown category' using errcode = '22023';
  end if;
  if p_tax_rate is not null and not exists (select 1 from public.tax_rates where id = p_tax_rate and organization_id = e.organization_id) then
    raise exception 'Unknown VAT rate' using errcode = '22023';
  end if;
  if p_card is not null and not exists (select 1 from public.company_cards where id = p_card and organization_id = e.organization_id) then
    raise exception 'Unknown card' using errcode = '22023';
  end if;
  if p_category is distinct from e.category_id then v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_array(e.category_id, p_category)); end if;
  if p_tax_rate is distinct from e.tax_rate_id then v_changes := v_changes || jsonb_build_object('tax_rate_id', jsonb_build_array(e.tax_rate_id, p_tax_rate)); end if;
  if p_tax is distinct from e.tax_amount then v_changes := v_changes || jsonb_build_object('tax_amount', jsonb_build_array(e.tax_amount, p_tax)); end if;
  if p_card is distinct from e.card_id then v_changes := v_changes || jsonb_build_object('card_id', jsonb_build_array(e.card_id, p_card)); end if;
  if v_changes = '{}'::jsonb then
    return;
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses set category_id = p_category, tax_rate_id = p_tax_rate, tax_amount = p_tax,
    card_id = case when p_card is null then null else p_card end,
    payment_method = case when p_card is not null then 'company_card' else payment_method end
    where id = p_id;
  insert into public.expense_events (organization_id, expense_id, actor_id, event, note, changes)
  values (e.organization_id, p_id, auth.uid(), 'corrected', coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), 'Coded for accounting'), v_changes);
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Card matching
-- ---------------------------------------------------------------------------

-- Matches unmatched statement lines to card expenses with the same amount and currency
-- within 3 days, one-to-one, closest date first. Returns the number of new matches.
create or replace function public.auto_match_card(p_card uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  c public.company_cards%rowtype;
  t record;
  v_exp uuid;
  v_count integer := 0;
begin
  select * into c from public.company_cards where id = p_card;
  if not found or not public.is_finance(c.organization_id) then
    raise exception 'Finance permission required' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  for t in select * from public.card_transactions where card_id = p_card and status = 'unmatched' order by txn_date loop
    select e.id into v_exp from public.expenses e
      where e.organization_id = c.organization_id and e.status in ('draft', 'submitted', 'approved')
        and e.payment_method = 'company_card'
        and (e.card_id = p_card or (e.card_id is null and e.membership_id = c.holder_membership_id))
        and e.total = t.amount and e.currency = t.currency
        and e.expense_date between t.txn_date - 3 and t.txn_date + 3
        and not exists (select 1 from public.card_transactions x where x.expense_id = e.id)
      order by abs(e.expense_date - t.txn_date), e.created_at
      limit 1;
    if v_exp is not null then
      update public.card_transactions set status = 'matched', expense_id = v_exp, matched_by = auth.uid(), matched_at = now() where id = t.id;
      update public.expenses set card_id = p_card where id = v_exp and card_id is null;
      v_count := v_count + 1;
    end if;
  end loop;
  perform set_config('wbh.trusted_op', 'off', true);
  return v_count;
end;
$$;

create or replace function public.set_card_transaction(p_txn uuid, p_action text, p_expense uuid default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.card_transactions%rowtype;
begin
  select * into t from public.card_transactions where id = p_txn for update;
  if not found or not public.is_finance(t.organization_id) then
    raise exception 'Finance permission required' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  if p_action = 'match' then
    if not exists (select 1 from public.expenses where id = p_expense and organization_id = t.organization_id and status <> 'cancelled') then
      raise exception 'Choose an expense' using errcode = '22023';
    end if;
    if exists (select 1 from public.card_transactions where expense_id = p_expense and id <> p_txn) then
      raise exception 'That expense is already matched to another card line' using errcode = '22023';
    end if;
    update public.card_transactions set status = 'matched', expense_id = p_expense, matched_by = auth.uid(), matched_at = now(), note = coalesce(p_note, note) where id = p_txn;
    update public.expenses set card_id = t.card_id, payment_method = 'company_card' where id = p_expense and accounting_export_id is null;
  elsif p_action = 'unmatch' then
    update public.card_transactions set status = 'unmatched', expense_id = null, matched_by = null, matched_at = null where id = p_txn;
  elsif p_action = 'ignore' then
    update public.card_transactions set status = 'ignored', expense_id = null, matched_by = auth.uid(), matched_at = now(),
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Ignored') where id = p_txn;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

-- Creates a draft expense for the card holder from a statement line and asks them for the receipt.
create or replace function public.request_card_receipt(p_txn uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.card_transactions%rowtype;
  c public.company_cards%rowtype;
  v_id uuid;
  v_user uuid;
begin
  select * into t from public.card_transactions where id = p_txn for update;
  if not found or not public.is_finance(t.organization_id) then
    raise exception 'Finance permission required' using errcode = '42501';
  end if;
  if t.status <> 'unmatched' then
    raise exception 'This line is already matched or ignored' using errcode = '22023';
  end if;
  select * into c from public.company_cards where id = t.card_id;
  if c.holder_membership_id is null then
    raise exception 'Set a card holder first' using errcode = '22023';
  end if;
  v_user := public.membership_user_of(c.holder_membership_id);
  perform set_config('wbh.trusted_op', 'on', true);
  insert into public.expenses (organization_id, membership_id, status, expense_date, merchant, currency, total, payment_method,
                               reimbursable, card_id, description, created_by)
  values (t.organization_id, c.holder_membership_id, 'draft', t.txn_date, left(t.description, 200), t.currency, t.amount, 'company_card',
          false, c.id, null, v_user)
  returning id into v_id;
  update public.card_transactions set status = 'matched', expense_id = v_id, matched_by = auth.uid(), matched_at = now() where id = p_txn;
  perform set_config('wbh.trusted_op', 'off', true);
  perform public.notify(t.organization_id, v_user, 'expense', 'Receipt needed for a card payment',
    t.description || ' · ' || t.currency || ' ' || to_char(t.amount, 'FM999G999G990D00') || ' on ' || to_char(t.txn_date, 'DD Mon'),
    '/o/' || public.org_slug(t.organization_id) || '/expenses/' || v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Month close and export marking
-- ---------------------------------------------------------------------------

create or replace function public.set_period_closed(p_org uuid, p_month date, p_closed boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_permission(p_org, 'expenses.export') then
    raise exception 'expenses.export permission required' using errcode = '42501';
  end if;
  if p_closed then
    insert into public.accounting_periods (organization_id, month, closed_by)
    values (p_org, date_trunc('month', p_month)::date, auth.uid())
    on conflict (organization_id, month) do update
      set closed_at = now(), closed_by = auth.uid(), reopened_at = null, reopened_by = null;
  else
    update public.accounting_periods set reopened_at = now(), reopened_by = auth.uid()
      where organization_id = p_org and month = date_trunc('month', p_month)::date and reopened_at is null;
  end if;
end;
$$;

create or replace function public.mark_accounting_export(p_org uuid, p_kind text, p_ids uuid[], p_filters jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_rows integer;
begin
  if not public.has_permission(p_org, 'expenses.export') then
    raise exception 'expenses.export permission required' using errcode = '42501';
  end if;
  insert into public.accounting_exports (organization_id, kind, actor_id, row_count, filters)
  values (p_org, p_kind, auth.uid(), 0, coalesce(p_filters, '{}'::jsonb))
  returning id into v_id;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses set accounting_export_id = v_id, accounting_exported_at = now()
    where organization_id = p_org and id = any (p_ids) and status = 'approved' and accounting_export_id is null;
  get diagnostics v_rows = row_count;
  update public.accounting_exports set row_count = v_rows where id = v_id;
  perform set_config('wbh.trusted_op', 'off', true);
  return v_id;
end;
$$;

create or replace function public.undo_accounting_export(p_export uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  x public.accounting_exports%rowtype;
  v_rows integer;
begin
  select * into x from public.accounting_exports where id = p_export for update;
  if not found or not public.has_permission(x.organization_id, 'expenses.export') then
    raise exception 'expenses.export permission required' using errcode = '42501';
  end if;
  if x.undone_at is not null then
    return 0;
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.expenses set accounting_export_id = null, accounting_exported_at = null where accounting_export_id = p_export;
  get diagnostics v_rows = row_count;
  update public.accounting_exports set undone_at = now(), undone_by = auth.uid() where id = p_export;
  perform set_config('wbh.trusted_op', 'off', true);
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.tax_rates enable row level security;
alter table public.accounting_settings enable row level security;
alter table public.company_cards enable row level security;
alter table public.card_imports enable row level security;
alter table public.card_transactions enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounting_exports enable row level security;

grant select, insert on public.tax_rates to authenticated;
grant update (name, rate, accounting_name, reclaimable, active, position) on public.tax_rates to authenticated;
create policy tax_rates_select on public.tax_rates for select to authenticated using (public.is_org_member(organization_id));
create policy tax_rates_insert on public.tax_rates for insert to authenticated
  with check (public.has_permission(organization_id, 'expenses.export') or public.has_permission(organization_id, 'org.settings.manage'));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (public.has_permission(organization_id, 'expenses.export') or public.has_permission(organization_id, 'org.settings.manage'))
  with check (public.has_permission(organization_id, 'expenses.export') or public.has_permission(organization_id, 'org.settings.manage'));

grant select, insert on public.accounting_settings to authenticated;
grant update (bill_prefix, bill_due_days, tracking_name, default_account_code) on public.accounting_settings to authenticated;
create policy accounting_settings_select on public.accounting_settings for select to authenticated using (public.is_org_member(organization_id));
create policy accounting_settings_insert on public.accounting_settings for insert to authenticated with check (public.has_permission(organization_id, 'expenses.export'));
create policy accounting_settings_update on public.accounting_settings for update to authenticated
  using (public.has_permission(organization_id, 'expenses.export')) with check (public.has_permission(organization_id, 'expenses.export'));

grant select, insert on public.company_cards to authenticated;
grant update (name, last4, holder_membership_id, currency, account_code, active) on public.company_cards to authenticated;
create policy company_cards_select on public.company_cards for select to authenticated using (public.can_see_card_row(organization_id, holder_membership_id));
create policy company_cards_insert on public.company_cards for insert to authenticated with check (public.is_finance(organization_id));
create policy company_cards_update on public.company_cards for update to authenticated
  using (public.is_finance(organization_id)) with check (public.is_finance(organization_id));

grant select, insert on public.card_imports to authenticated;
create policy card_imports_select on public.card_imports for select to authenticated using (public.is_finance(organization_id));
create policy card_imports_insert on public.card_imports for insert to authenticated
  with check (public.is_finance(organization_id) and imported_by = auth.uid());

grant select, insert on public.card_transactions to authenticated;
create policy card_transactions_select on public.card_transactions for select to authenticated using (public.can_see_card(card_id));
create policy card_transactions_insert on public.card_transactions for insert to authenticated
  with check (public.is_finance(organization_id) and status = 'unmatched' and expense_id is null);

grant select on public.accounting_periods to authenticated;
create policy accounting_periods_select on public.accounting_periods for select to authenticated using (public.is_org_member(organization_id));

grant select on public.accounting_exports to authenticated;
create policy accounting_exports_select on public.accounting_exports for select to authenticated
  using (public.has_permission(organization_id, 'expenses.export'));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_finance(uuid)', 'public.period_closed(uuid, date)', 'public.can_see_card(uuid)', 'public.can_see_card_row(uuid, uuid)',
    'public.code_expense(uuid, uuid, uuid, numeric, uuid, text)', 'public.auto_match_card(uuid)',
    'public.set_card_transaction(uuid, text, uuid, text)', 'public.request_card_receipt(uuid)',
    'public.set_period_closed(uuid, date, boolean)', 'public.mark_accounting_export(uuid, text, uuid[], jsonb)',
    'public.undo_accounting_export(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.guard_expense_bookkeeping() from public, anon, authenticated;

create trigger audit_tax_rates after insert or update or delete on public.tax_rates for each row execute function public.audit_row_change();
create trigger audit_company_cards after insert or update or delete on public.company_cards for each row execute function public.audit_row_change();
create trigger audit_card_transactions after update or delete on public.card_transactions for each row execute function public.audit_row_change('id', 'description');
create trigger audit_accounting_periods after insert or update on public.accounting_periods for each row execute function public.audit_row_change('organization_id');
create trigger audit_accounting_exports after insert or update on public.accounting_exports for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Seeds (UK VAT names as they appear in Xero; editable per organization)
-- ---------------------------------------------------------------------------

create or replace function public.seed_organization_bookkeeping(p_org uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_country text;
begin
  select country into v_country from public.organizations where id = p_org;
  insert into public.accounting_settings (organization_id) values (p_org) on conflict do nothing;
  if v_country = 'GB' then
    insert into public.tax_rates (organization_id, name, rate, accounting_name, reclaimable, position) values
      (p_org, 'Standard 20%', 20, '20% (VAT on Expenses)', true, 1),
      (p_org, 'Reduced 5%', 5, '5% (VAT on Expenses)', true, 2),
      (p_org, 'Zero rated', 0, 'Zero Rated Expenses', true, 3),
      (p_org, 'Exempt', 0, 'Exempt Expenses', false, 4),
      (p_org, 'No VAT / outside scope', 0, 'No VAT', false, 5),
      (p_org, 'Foreign tax (not reclaimable)', 0, 'No VAT', false, 6)
    on conflict (organization_id, name) do nothing;
  else
    insert into public.tax_rates (organization_id, name, rate, accounting_name, reclaimable, position) values
      (p_org, 'No tax', 0, 'Tax Exempt', false, 1)
    on conflict (organization_id, name) do nothing;
  end if;
end;
$$;

revoke all on function public.seed_organization_bookkeeping(uuid) from public, anon, authenticated;

create or replace function public.seed_bookkeeping_on_org()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform public.seed_organization_bookkeeping(new.id); return null; end; $$;

revoke all on function public.seed_bookkeeping_on_org() from public, anon, authenticated;

create trigger organizations_seed_bookkeeping after insert on public.organizations
  for each row execute function public.seed_bookkeeping_on_org();

select public.seed_organization_bookkeeping(id) from public.organizations;

-- Duplicates: the same file only counts when the amount also matches (one PDF can hold
-- several different receipts that are split into separate claims).
create or replace function public.expense_duplicates(p_expense uuid)
returns table (id uuid, reason text, status text)
language sql stable security definer set search_path = ''
as $$
  with me as (select * from public.expenses where id = p_expense and public.can_view_expense(p_expense)),
  my_hashes as (select f.sha256 from public.files f, me where f.context_type = 'expense' and f.context_id = me.id),
  same_file as (
    select o.id from public.expenses o, me
    where o.organization_id = me.organization_id and o.id <> me.id and o.status <> 'cancelled'
      and (o.total is not distinct from me.total or o.total is null or me.total is null)
      and exists (select 1 from public.files f2 where f2.context_type = 'expense' and f2.context_id = o.id
                  and f2.organization_id = o.organization_id and f2.sha256 in (select sha256 from my_hashes))
  ),
  same_purchase as (
    select o.id from public.expenses o, me
    where o.organization_id = me.organization_id and o.id <> me.id and o.status <> 'cancelled'
      and o.membership_id = me.membership_id and me.merchant is not null and me.expense_date is not null and me.total is not null
      and lower(btrim(o.merchant)) = lower(btrim(me.merchant)) and o.expense_date = me.expense_date and o.total = me.total
  ),
  same_amount_day as (
    -- e.g. an itemised receipt and the card slip for the same payment, uploaded as two claims
    select o.id from public.expenses o, me
    where o.organization_id = me.organization_id and o.id <> me.id and o.status <> 'cancelled'
      and o.membership_id = me.membership_id and me.expense_date is not null and me.total is not null and me.currency is not null
      and o.expense_date = me.expense_date and o.total = me.total and o.currency = me.currency
  )
  select o.id,
    case when o.id in (select id from same_file) then 'Same receipt file'
         when o.id in (select id from same_purchase) then 'Same merchant, date and amount'
         else 'Same date and amount (receipt and card slip?)' end,
    o.status
  from public.expenses o
  where o.id in (select id from same_file union select id from same_purchase union select id from same_amount_day);
$$;
