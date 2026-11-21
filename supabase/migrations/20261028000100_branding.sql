-- Company logo, shown in the app and on every exported report. Stored as a small PNG
-- (re-encoded by the server, max 600x200) so PDFs and Excel files can embed it directly.
create table public.organization_branding (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  logo_png_base64 text check (logo_png_base64 is null or char_length(logo_png_base64) <= 700000),
  logo_width integer,
  logo_height integer,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.organization_branding enable row level security;
grant select on public.organization_branding to authenticated;
create policy branding_select on public.organization_branding for select to authenticated
  using (public.is_org_member(organization_id));
-- Written by the server after it has checked org.settings.manage and re-encoded the image.

create trigger audit_organization_branding after insert or update on public.organization_branding
  for each row execute function public.audit_row_change('organization_id');
