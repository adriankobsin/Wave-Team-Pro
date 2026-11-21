-- Named layers on a drawing (e.g. "Access points", "Keypads", "Speakers"): each marker sits on one
-- layer; layers can be shown/hidden and exported on their own.

create table public.drawing_layers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  drawing_id uuid not null references public.project_drawings (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text check (kind is null or kind in ('keypad', 'touch_panel', 'access_point', 'speaker', 'subwoofer', 'tv', 'camera', 'sensor', 'data_point', 'intercom', 'phone', 'light', 'other')),
  color text not null default '#6b7280' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort int not null default 0,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index drawing_layers_name on public.drawing_layers (drawing_id, lower(name));

alter table public.drawing_markers add column if not exists layer_id uuid references public.drawing_layers (id) on delete cascade;
create index drawing_markers_layer on public.drawing_markers (layer_id);

create or replace function public.guard_drawing_layer()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.project_drawings d where d.id = new.drawing_id and d.project_id = new.project_id) then
    raise exception 'Drawing not found' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.drawing_id <> old.drawing_id then
    raise exception 'A layer cannot move to another drawing' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_drawing_layer() from public, anon, authenticated;

create or replace function public.guard_drawing_marker()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.project_drawings d where d.id = new.drawing_id and d.project_id = new.project_id) then
    raise exception 'Drawing not found' using errcode = '23503';
  end if;
  if new.layer_id is not null and not exists (select 1 from public.drawing_layers l where l.id = new.layer_id and l.drawing_id = new.drawing_id) then
    raise exception 'Layer not found' using errcode = '23503';
  end if;
  if new.device_id is not null and not exists (select 1 from public.site_devices d where d.id = new.device_id and d.project_id = new.project_id) then
    raise exception 'Device not found' using errcode = '23503';
  end if;
  if new.lutron_item_id is not null and not exists (select 1 from public.lutron_items l where l.id = new.lutron_item_id and l.project_id = new.project_id) then
    raise exception 'Keypad not found' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger drawing_layers_guard before insert or update on public.drawing_layers for each row execute function public.guard_site_row();
create trigger drawing_layers_check before insert or update on public.drawing_layers for each row execute function public.guard_drawing_layer();

alter table public.drawing_layers enable row level security;
create policy drawing_layers_select on public.drawing_layers for select to authenticated using (public.can_view_project(project_id));
create policy drawing_layers_insert on public.drawing_layers for insert to authenticated with check (public.can_log_on_project(project_id));
create policy drawing_layers_update on public.drawing_layers for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy drawing_layers_delete on public.drawing_layers for delete to authenticated using (public.can_log_on_project(project_id));
grant select, insert, update, delete on public.drawing_layers to authenticated;

-- Markers placed before layers existed: one layer per drawing and type.
insert into public.drawing_layers (project_id, drawing_id, name, kind, color, sort)
select distinct m.project_id, m.drawing_id,
  case m.kind when 'keypad' then 'Keypads' when 'touch_panel' then 'Touch panels' when 'access_point' then 'Access points'
    when 'speaker' then 'Speakers' when 'subwoofer' then 'Subwoofers' when 'tv' then 'TVs and displays' when 'camera' then 'Cameras'
    when 'sensor' then 'Sensors' when 'data_point' then 'Data points' when 'intercom' then 'Intercoms' when 'phone' then 'Phones'
    when 'light' then 'Lights' else 'Other' end,
  m.kind,
  case m.kind when 'keypad' then '#b07d2b' when 'touch_panel' then '#7c3aed' when 'access_point' then '#0284c7' when 'speaker' then '#16a34a'
    when 'subwoofer' then '#166534' when 'tv' then '#db2777' when 'camera' then '#dc2626' when 'sensor' then '#ca8a04' when 'data_point' then '#475569'
    when 'intercom' then '#9333ea' when 'phone' then '#0d9488' when 'light' then '#f59e0b' else '#6b7280' end,
  0
from public.drawing_markers m where m.layer_id is null;

update public.drawing_markers m set layer_id = l.id
from public.drawing_layers l
where m.layer_id is null and l.drawing_id = m.drawing_id and l.kind = m.kind;
