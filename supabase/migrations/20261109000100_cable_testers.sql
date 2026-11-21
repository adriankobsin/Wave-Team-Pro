-- Cables can be tested by more than one person: "Tested by" becomes a list picked from the
-- project team. tested_by stays as the first of them (older reports, history and exports).
alter table public.site_cables add column tested_by_ids uuid[] not null default '{}'
  check (cardinality(tested_by_ids) <= 20);
update public.site_cables set tested_by_ids = array[tested_by] where tested_by is not null and tested_by_ids = '{}';
