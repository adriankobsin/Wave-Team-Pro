-- Short links behind QR stickers (/q/<code>): small codes scan reliably when printed small,
-- and a sticker keeps working even if the app's URLs change. Opening one still needs a
-- signed-in user who can see the project.

create table public.qr_links (
  code text primary key check (code ~ '^[a-z0-9]{8}$'),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  target text not null check (char_length(target) <= 500 and (target = '' or target ~ '^/[A-Za-z0-9/_.~%?&=+-]*$')),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (project_id, target)
);

create trigger qr_links_guard before insert or update on public.qr_links for each row execute function public.guard_site_row();

alter table public.qr_links enable row level security;
create policy qr_links_select on public.qr_links for select to authenticated using (public.can_view_project(project_id));
create policy qr_links_insert on public.qr_links for insert to authenticated with check (public.can_view_project(project_id));
grant select, insert on public.qr_links to authenticated;
