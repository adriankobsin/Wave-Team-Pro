-- Cable runs drawn on a drawing, like a line schematic: keypad to keypad, speakers back to the amp,
-- access points to their rack. Each run belongs to a layer (so it takes the layer's system colour and
-- shows / hides / exports with it) and is a polyline of points given as fractions of the page.
-- A point can be pinned to a marker ({"x":…, "y":…, "m": "<marker id>"}) so the line follows it
-- when the marker is moved; the run can end at one of the project's racks.

create table public.drawing_cables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  drawing_id uuid not null references public.project_drawings (id) on delete cascade,
  layer_id uuid not null references public.drawing_layers (id) on delete cascade,
  page int not null default 1 check (page >= 1),
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 400),
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  cable_type text check (cable_type is null or char_length(btrim(cable_type)) between 1 and 60),
  rack_id uuid references public.site_racks (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index drawing_cables_drawing on public.drawing_cables (drawing_id, page);
create index drawing_cables_layer on public.drawing_cables (layer_id);

create or replace function public.guard_drawing_cable()
returns trigger language plpgsql set search_path = ''
as $$
declare
  p jsonb;
begin
  if not exists (select 1 from public.project_drawings d where d.id = new.drawing_id and d.project_id = new.project_id) then
    raise exception 'Drawing not found' using errcode = '23503';
  end if;
  if not exists (select 1 from public.drawing_layers l where l.id = new.layer_id and l.drawing_id = new.drawing_id) then
    raise exception 'Layer not found' using errcode = '23503';
  end if;
  if new.rack_id is not null and not exists (select 1 from public.site_racks r where r.id = new.rack_id and r.project_id = new.project_id) then
    raise exception 'Rack not found' using errcode = '23503';
  end if;
  for p in select * from jsonb_array_elements(new.points) loop
    if jsonb_typeof(p -> 'x') <> 'number' or jsonb_typeof(p -> 'y') <> 'number'
      or (p ->> 'x')::numeric not between 0 and 1 or (p ->> 'y')::numeric not between 0 and 1 then
      raise exception 'Cable points must be on the page' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_drawing_cable() from public, anon, authenticated;

create trigger drawing_cables_guard before insert or update on public.drawing_cables for each row execute function public.guard_site_row();
create trigger drawing_cables_check before insert or update on public.drawing_cables for each row execute function public.guard_drawing_cable();

alter table public.drawing_cables enable row level security;
create policy drawing_cables_select on public.drawing_cables for select to authenticated using (public.can_view_project(project_id));
create policy drawing_cables_insert on public.drawing_cables for insert to authenticated with check (public.can_log_on_project(project_id));
create policy drawing_cables_update on public.drawing_cables for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy drawing_cables_delete on public.drawing_cables for delete to authenticated using (public.can_log_on_project(project_id));
grant select, insert, update, delete on public.drawing_cables to authenticated;
