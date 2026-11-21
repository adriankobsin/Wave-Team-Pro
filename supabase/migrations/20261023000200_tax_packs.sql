-- Standard VAT / GST rate sets per country (rates checked October 2026; editable per company).
-- "accounting_name" is a starting point: it must be edited to match the tax rate names in each
-- company's Xero file.

create or replace function public.tax_rate_pack(p_country text)
returns table (name text, rate numeric, accounting_name text, reclaimable boolean, sort_order integer)
language sql immutable set search_path = ''
as $$
  select name, rate, accounting_name, reclaimable, sort_order from (values
    -- United Kingdom (VAT)
    ('GB', 'Standard 20%', 20.0, '20% (VAT on Expenses)', true, 1),
    ('GB', 'Reduced 5%', 5.0, '5% (VAT on Expenses)', true, 2),
    ('GB', 'Zero rated', 0.0, 'Zero Rated Expenses', true, 3),
    ('GB', 'Exempt', 0.0, 'Exempt Expenses', false, 4),
    -- Spain (IVA)
    ('ES', 'IVA general 21%', 21.0, 'IVA 21%', true, 1),
    ('ES', 'IVA reducido 10%', 10.0, 'IVA 10%', true, 2),
    ('ES', 'IVA superreducido 4%', 4.0, 'IVA 4%', true, 3),
    ('ES', 'Exento', 0.0, 'Exento', false, 4),
    -- France and Monaco (TVA)
    ('FR', 'TVA normale 20%', 20.0, 'TVA 20%', true, 1),
    ('FR', 'TVA intermédiaire 10%', 10.0, 'TVA 10%', true, 2),
    ('FR', 'TVA réduite 5.5%', 5.5, 'TVA 5,5%', true, 3),
    ('FR', 'TVA particulière 2.1%', 2.1, 'TVA 2,1%', true, 4),
    ('FR', 'Exonéré', 0.0, 'Exonéré', false, 5),
    ('MC', 'TVA normale 20%', 20.0, 'TVA 20%', true, 1),
    ('MC', 'TVA intermédiaire 10%', 10.0, 'TVA 10%', true, 2),
    ('MC', 'TVA réduite 5.5%', 5.5, 'TVA 5,5%', true, 3),
    ('MC', 'Exonéré', 0.0, 'Exonéré', false, 4),
    -- Italy (IVA)
    ('IT', 'IVA ordinaria 22%', 22.0, 'IVA 22%', true, 1),
    ('IT', 'IVA ridotta 10%', 10.0, 'IVA 10%', true, 2),
    ('IT', 'IVA ridotta 5%', 5.0, 'IVA 5%', true, 3),
    ('IT', 'IVA minima 4%', 4.0, 'IVA 4%', true, 4),
    ('IT', 'Esente', 0.0, 'Esente', false, 5),
    -- Germany (MwSt)
    ('DE', 'MwSt 19%', 19.0, 'MwSt 19%', true, 1),
    ('DE', 'MwSt ermäßigt 7%', 7.0, 'MwSt 7%', true, 2),
    ('DE', 'Steuerfrei', 0.0, 'Steuerfrei', false, 3),
    -- Netherlands (BTW)
    ('NL', 'BTW hoog 21%', 21.0, 'BTW 21%', true, 1),
    ('NL', 'BTW laag 9%', 9.0, 'BTW 9%', true, 2),
    ('NL', 'BTW 0%', 0.0, 'BTW 0%', true, 3),
    ('NL', 'Vrijgesteld', 0.0, 'Vrijgesteld', false, 4),
    -- Belgium
    ('BE', 'BTW/TVA 21%', 21.0, 'BTW 21%', true, 1),
    ('BE', 'BTW/TVA 12%', 12.0, 'BTW 12%', true, 2),
    ('BE', 'BTW/TVA 6%', 6.0, 'BTW 6%', true, 3),
    ('BE', 'Vrijgesteld / Exonéré', 0.0, 'Vrijgesteld', false, 4),
    -- Portugal
    ('PT', 'IVA normal 23%', 23.0, 'IVA 23%', true, 1),
    ('PT', 'IVA intermédio 13%', 13.0, 'IVA 13%', true, 2),
    ('PT', 'IVA reduzido 6%', 6.0, 'IVA 6%', true, 3),
    ('PT', 'Isento', 0.0, 'Isento', false, 4),
    -- Ireland
    ('IE', 'Standard 23%', 23.0, '23% VAT', true, 1),
    ('IE', 'Reduced 13.5%', 13.5, '13.5% VAT', true, 2),
    ('IE', 'Second reduced 9%', 9.0, '9% VAT', true, 3),
    ('IE', 'Livestock 4.8%', 4.8, '4.8% VAT', true, 4),
    ('IE', 'Zero rated', 0.0, 'Zero rated', true, 5),
    ('IE', 'Exempt', 0.0, 'Exempt', false, 6),
    -- Croatia (PDV)
    ('HR', 'PDV 25%', 25.0, 'PDV 25%', true, 1),
    ('HR', 'PDV 13%', 13.0, 'PDV 13%', true, 2),
    ('HR', 'PDV 5%', 5.0, 'PDV 5%', true, 3),
    ('HR', 'Oslobođeno', 0.0, 'Oslobođeno', false, 4),
    -- Greece
    ('GR', 'ΦΠΑ 24%', 24.0, 'VAT 24%', true, 1),
    ('GR', 'ΦΠΑ 13%', 13.0, 'VAT 13%', true, 2),
    ('GR', 'ΦΠΑ 6%', 6.0, 'VAT 6%', true, 3),
    ('GR', 'Exempt', 0.0, 'Exempt', false, 4),
    -- Malta
    ('MT', 'Standard 18%', 18.0, 'VAT 18%', true, 1),
    ('MT', 'Reduced 12%', 12.0, 'VAT 12%', true, 2),
    ('MT', 'Reduced 7%', 7.0, 'VAT 7%', true, 3),
    ('MT', 'Reduced 5%', 5.0, 'VAT 5%', true, 4),
    ('MT', 'Exempt', 0.0, 'Exempt', false, 5),
    -- Cyprus
    ('CY', 'Standard 19%', 19.0, 'VAT 19%', true, 1),
    ('CY', 'Reduced 9%', 9.0, 'VAT 9%', true, 2),
    ('CY', 'Reduced 5%', 5.0, 'VAT 5%', true, 3),
    ('CY', 'Super-reduced 3%', 3.0, 'VAT 3%', true, 4),
    ('CY', 'Exempt', 0.0, 'Exempt', false, 5),
    -- Singapore (GST)
    ('SG', 'GST standard 9%', 9.0, 'Standard-Rated Purchases', true, 1),
    ('SG', 'GST zero-rated', 0.0, 'Zero-Rated Purchases', true, 2),
    ('SG', 'GST exempt', 0.0, 'Exempt Purchases', false, 3),
    ('SG', 'Not GST-registered supplier', 0.0, 'No GST', false, 4),
    -- Thailand (VAT 7%: reduced from the statutory 10% until 30 Sep 2027)
    ('TH', 'VAT 7%', 7.0, 'VAT 7%', true, 1),
    ('TH', 'VAT 0%', 0.0, 'VAT 0%', true, 2),
    ('TH', 'VAT exempt', 0.0, 'VAT Exempt', false, 3),
    ('TH', 'Non-VAT-registered supplier', 0.0, 'No VAT', false, 4),
    -- Cambodia (VAT)
    ('KH', 'VAT 10%', 10.0, 'VAT 10%', true, 1),
    ('KH', 'VAT 0%', 0.0, 'VAT 0%', true, 2),
    ('KH', 'Non-VAT supplier / no invoice', 0.0, 'No VAT', false, 3)
  ) as p(country, name, rate, accounting_name, reclaimable, sort_order)
  where p.country = upper(p_country)
  union all
  select name, rate, accounting_name, reclaimable, sort_order from (values
    ('No VAT / outside scope', 0.0, 'No VAT', false, 20),
    ('Foreign tax (not reclaimable)', 0.0, 'No VAT', false, 21)
  ) as g(name, rate, accounting_name, reclaimable, sort_order);
$$;

-- Adds a country's standard rates to a company (skips names that already exist).
create or replace function public.load_tax_rate_pack(p_org uuid, p_country text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not (public.has_permission(p_org, 'expenses.export') or public.has_permission(p_org, 'org.settings.manage')) then
    raise exception 'You cannot manage VAT rates' using errcode = '42501';
  end if;
  insert into public.tax_rates (organization_id, name, rate, accounting_name, reclaimable, position)
  select p_org, p.name, p.rate, p.accounting_name, p.reclaimable, p.sort_order
  from public.tax_rate_pack(p_country) p
  on conflict (organization_id, name) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.seed_organization_bookkeeping(p_org uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_country text;
begin
  select country into v_country from public.organizations where id = p_org;
  insert into public.accounting_settings (organization_id) values (p_org) on conflict do nothing;
  insert into public.tax_rates (organization_id, name, rate, accounting_name, reclaimable, position)
  select p_org, p.name, p.rate, p.accounting_name, p.reclaimable, p.sort_order
  from public.tax_rate_pack(v_country) p
  on conflict (organization_id, name) do nothing;
end;
$$;

-- Re-applies exchange rates to claims that have none yet (after rates were added).
create or replace function public.refresh_expense_fx(p_org uuid, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  if not public.is_finance(p_org) then
    raise exception 'Finance permission required' using errcode = '42501';
  end if;
  for r in
    select id from public.expenses
    where organization_id = p_org and status in ('submitted', 'approved') and reporting_total is null
      and currency is not null and total is not null and expense_date between p_from and p_to
      and accounting_export_id is null
  loop
    perform public.apply_expense_fx(r.id);
    v_count := v_count + 1;
  end loop;
  return (select count(*) from public.expenses where organization_id = p_org and reporting_total is not null
          and expense_date between p_from and p_to and status in ('submitted', 'approved'));
end;
$$;

revoke all on function public.tax_rate_pack(text) from public, anon;
grant execute on function public.tax_rate_pack(text) to authenticated;
revoke all on function public.load_tax_rate_pack(uuid, text) from public, anon;
grant execute on function public.load_tax_rate_pack(uuid, text) to authenticated;
revoke all on function public.refresh_expense_fx(uuid, date, date) from public, anon;
grant execute on function public.refresh_expense_fx(uuid, date, date) to authenticated;
revoke all on function public.seed_organization_bookkeeping(uuid) from public, anon, authenticated;

-- Existing companies keep their rates; missing standard ones for their country are added.
select public.seed_organization_bookkeeping(id) from public.organizations;
