-- Stored logins belong to a project (the company-wide Passwords page was removed).
alter table public.credentials add constraint credentials_project_required check (project_id is not null) not valid;
alter table public.credentials validate constraint credentials_project_required;
