-- Staff calendar: who works on which project and when, with Outlook invites to the staff, and
-- travel & accommodation requests to each company's travel coordinators (PAs), who enter the
-- bookings here so they land in the traveller's calendar too.

insert into public.permissions (key, module, description, allowed_scopes, is_sensitive, sort_order) values
  ('staffing.view', 'projects', 'See the staff calendar: who is assigned to which project, and when', '{organization}', false, 60),
  ('staffing.assign', 'projects', 'Assign staff to projects for dates (sends them calendar invites)', '{organization}', false, 61),
  ('travel.manage', 'projects', 'Handle travel and accommodation requests and enter the bookings', '{organization}', true, 62)
on conflict (key) do nothing;

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, k.key
from public.roles r
join (values
  ('staffing.view', 'super_admin'), ('staffing.view', 'director'), ('staffing.view', 'project_manager'), ('staffing.view', 'hr_manager'), ('staffing.view', 'va_admin'),
  ('staffing.assign', 'super_admin'), ('staffing.assign', 'director'), ('staffing.assign', 'project_manager'),
  ('travel.manage', 'super_admin'), ('travel.manage', 'va_admin')
) as k(key, role_key) on k.role_key = r.key
on conflict do nothing;

-- New companies get the same defaults when their system roles are created.
create or replace function public.grant_staffing_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_system then
    perform set_config('wbh.trusted_op', 'on', true);
    insert into public.role_permissions (organization_id, role_id, permission_key)
    select new.organization_id, new.id, k.key
    from (values
      ('staffing.view', 'super_admin'), ('staffing.view', 'director'), ('staffing.view', 'project_manager'), ('staffing.view', 'hr_manager'), ('staffing.view', 'va_admin'),
      ('staffing.assign', 'super_admin'), ('staffing.assign', 'director'), ('staffing.assign', 'project_manager'),
      ('travel.manage', 'super_admin'), ('travel.manage', 'va_admin')
    ) as k(key, role_key)
    where k.role_key = new.key
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.grant_staffing_defaults() from public, anon, authenticated;
create or replace trigger roles_grant_staffing after insert on public.roles
  for each row execute function public.grant_staffing_defaults();

-- Staffing invites, travel request emails and booking invites reuse the Outlook queue
-- (calendar_broadcasts → calendar_sync 'manual'). These say where a row came from, where its
-- link points, and who is copied on request emails.
alter table public.calendar_broadcasts
  add column source text check (source is null or source in ('staffing', 'travel_request', 'travel_booking')),
  add column link_path text check (link_path is null or (link_path like '/%' and char_length(link_path) <= 300)),
  add column cc_emails text[] not null default '{}';

-- Who handles travel for a company. "lead" people get the request email; the others are copied.
create table public.travel_coordinators (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  membership_id uuid not null,
  is_lead boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, membership_id),
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete cascade
);
alter table public.travel_coordinators enable row level security;

/** Is the signed-in person a travel coordinator of this company? */
create or replace function public.is_travel_coordinator(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.travel_coordinators t
    join public.organization_memberships m on m.id = t.membership_id
    where t.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;
revoke all on function public.is_travel_coordinator(uuid) from public, anon;
grant execute on function public.is_travel_coordinator(uuid) to authenticated;

create or replace function public.can_handle_travel(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_permission(p_org, 'travel.manage') or public.is_travel_coordinator(p_org);
$$;
revoke all on function public.can_handle_travel(uuid) from public, anon;
grant execute on function public.can_handle_travel(uuid) to authenticated;

create or replace function public.can_view_staffing(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_permission(p_org, 'staffing.view') or public.has_permission(p_org, 'staffing.assign') or public.can_handle_travel(p_org);
$$;
revoke all on function public.can_view_staffing(uuid) from public, anon;
grant execute on function public.can_view_staffing(uuid) to authenticated;

create policy travel_coordinators_select on public.travel_coordinators for select to authenticated
  using (public.can_view_staffing(organization_id) or public.has_permission(organization_id, 'org.settings.manage'));
grant select on public.travel_coordinators to authenticated;

-- One person on one project for a run of days.
create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null,
  membership_id uuid not null,
  start_date date not null,
  end_date date not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  needs_travel boolean not null default false,
  broadcast_id uuid references public.calendar_broadcasts (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (end_date >= start_date and end_date - start_date <= 366),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete restrict,
  foreign key (membership_id, organization_id) references public.organization_memberships (id, organization_id) on delete restrict
);
create index staff_assignments_dates_idx on public.staff_assignments (organization_id, start_date, end_date) where cancelled_at is null;
create index staff_assignments_member_idx on public.staff_assignments (membership_id, start_date) where cancelled_at is null;
alter table public.staff_assignments enable row level security;

/** Is this membership the signed-in person's own? */
create or replace function public.is_my_membership(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.organization_memberships m where m.id = p_membership and m.user_id = auth.uid());
$$;
revoke all on function public.is_my_membership(uuid) from public, anon;
grant execute on function public.is_my_membership(uuid) to authenticated;

create policy staff_assignments_select on public.staff_assignments for select to authenticated
  using (public.can_view_staffing(organization_id) or public.is_my_membership(membership_id));
grant select on public.staff_assignments to authenticated;

-- The request to the travel coordinators for one assignment.
create table public.travel_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  assignment_id uuid not null unique references public.staff_assignments (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'booked', 'cancelled')),
  travel_from text check (travel_from is null or char_length(travel_from) <= 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  coordinator_notes text check (coordinator_notes is null or char_length(coordinator_notes) <= 2000),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index travel_requests_org_idx on public.travel_requests (organization_id, status, requested_at desc);
alter table public.travel_requests enable row level security;

create or replace function public.can_view_travel_request(p_org uuid, p_assignment uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.can_view_staffing(p_org)
    or exists (select 1 from public.staff_assignments a where a.id = p_assignment and public.is_my_membership(a.membership_id));
$$;
revoke all on function public.can_view_travel_request(uuid, uuid) from public, anon;
grant execute on function public.can_view_travel_request(uuid, uuid) to authenticated;

create policy travel_requests_select on public.travel_requests for select to authenticated
  using (public.can_view_travel_request(organization_id, assignment_id));
grant select on public.travel_requests to authenticated;

-- Flights, hotels and other bookings the coordinators enter for a request.
create table public.travel_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  request_id uuid not null references public.travel_requests (id) on delete cascade,
  kind text not null check (kind in ('flight', 'hotel', 'train', 'car', 'transfer', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  reference text check (reference is null or char_length(reference) <= 100),
  from_place text check (from_place is null or char_length(from_place) <= 200),
  to_place text check (to_place is null or char_length(to_place) <= 200),
  address text check (address is null or char_length(address) <= 300),
  all_day boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  start_tz text not null default 'UTC',
  end_tz text not null default 'UTC',
  notes text check (notes is null or char_length(notes) <= 2000),
  broadcast_id uuid references public.calendar_broadcasts (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at)
);
create index travel_bookings_request_idx on public.travel_bookings (request_id, starts_at) where cancelled_at is null;
alter table public.travel_bookings enable row level security;
create policy travel_bookings_select on public.travel_bookings for select to authenticated
  using (exists (select 1 from public.travel_requests r where r.id = request_id and public.can_view_travel_request(r.organization_id, r.assignment_id)));
grant select on public.travel_bookings to authenticated;
