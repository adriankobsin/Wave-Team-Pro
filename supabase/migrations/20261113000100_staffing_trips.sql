-- People assigned together are one trip: changing or removing it can apply to everyone on it.
alter table public.staff_assignments add column batch_id uuid;
create index staff_assignments_batch_idx on public.staff_assignments (batch_id) where batch_id is not null;

update public.staff_assignments a set batch_id = g.batch
from (
  select id, first_value(id) over (
    partition by organization_id, project_id, created_by, start_date, end_date, date_trunc('minute', created_at)
    order by created_at
  ) as batch
  from public.staff_assignments
) g
where g.id = a.id and a.batch_id is null;

-- When the dates of a trip change after travel was requested, the request shows what changed
-- so the coordinators can rebook.
alter table public.travel_requests
  add column dates_changed_from text check (dates_changed_from is null or char_length(dates_changed_from) <= 100),
  add column dates_changed_at timestamptz;
