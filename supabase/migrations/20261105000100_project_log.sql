-- Project log: dated notes on a project — deliveries received, orders placed, issues, meetings,
-- general memos — with supplier, reference, amount and photos (delivery notes, receipts).

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  kind text not null default 'note' check (kind in ('note', 'delivery', 'order', 'issue', 'meeting', 'other')),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  body text check (body is null or char_length(body) <= 8000),
  supplier text check (supplier is null or char_length(supplier) <= 200),
  reference text check (reference is null or char_length(reference) <= 120),
  amount numeric(14, 2) check (amount is null or amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index project_notes_project_idx on public.project_notes (project_id, occurred_at desc);

create table public.project_note_files (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.project_notes (id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) <= 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index project_note_files_note_idx on public.project_note_files (note_id);

create or replace function public.can_view_project_note(p_note uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.project_notes n where n.id = p_note and n.archived_at is null and public.can_view_project(n.project_id));
$$;

-- Who may write in a project's log: its team, its managers and anyone who edits projects.
create or replace function public.can_log_on_project(p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.can_edit_project(p_project) or public.is_project_member(p_project)
    or exists (select 1 from public.projects p where p.id = p_project and public.has_permission(p.organization_id, 'tasks.view.all'));
$$;

create or replace function public.guard_project_note()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    select organization_id into new.organization_id from public.projects where id = new.project_id;
    if not public.can_log_on_project(new.project_id) then
      raise exception 'You can only add notes to projects you work on' using errcode = '42501';
    end if;
  else
    if new.project_id <> old.project_id or new.created_by <> old.created_by or new.organization_id <> old.organization_id then
      raise exception 'Note identity fields are immutable' using errcode = '42501';
    end if;
    if old.created_by <> auth.uid() and not public.can_edit_project(old.project_id) then
      raise exception 'Only the author or the project manager can change this note' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.guard_project_note() from public, anon, authenticated;
create trigger project_notes_guard before insert or update on public.project_notes
  for each row execute function public.guard_project_note();
create trigger audit_project_notes after insert or update on public.project_notes
  for each row execute function public.audit_row_change();

alter table public.project_notes enable row level security;
alter table public.project_note_files enable row level security;

grant select, insert on public.project_notes to authenticated;
grant update (kind, title, body, supplier, reference, amount, currency, occurred_at, archived_at) on public.project_notes to authenticated;
create policy project_notes_select on public.project_notes for select to authenticated
  using (public.can_view_project(project_id));
create policy project_notes_insert on public.project_notes for insert to authenticated
  with check (public.can_log_on_project(project_id));
create policy project_notes_update on public.project_notes for update to authenticated
  using (created_by = auth.uid() or public.can_edit_project(project_id))
  with check (created_by = auth.uid() or public.can_edit_project(project_id));

-- Files are written by the server after validating the upload; people only read them.
grant select on public.project_note_files to authenticated;
create policy project_note_files_select on public.project_note_files for select to authenticated
  using (public.can_view_project_note(note_id));

grant execute on function public.can_view_project_note(uuid) to authenticated;
grant execute on function public.can_log_on_project(uuid) to authenticated;
