-- The group's own logo for Group Hub (each company keeps its own logo for its pages and reports).
create table if not exists public.platform_branding (
  id boolean primary key default true check (id),
  logo_png_base64 text,
  logo_width integer,
  logo_height integer,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.platform_branding (id) values (true) on conflict do nothing;
alter table public.platform_branding enable row level security;
grant select on public.platform_branding to authenticated;
create policy platform_branding_select on public.platform_branding for select to authenticated using (true);
