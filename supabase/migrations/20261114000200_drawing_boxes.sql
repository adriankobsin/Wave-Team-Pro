-- Square "box" items on drawings: Lutron shade control boxes, lighting panels (distribution-board
-- style) and racks. A rack placed on a drawing can be linked to one of the project's racks.

alter table public.drawing_markers drop constraint drawing_markers_kind_check;
alter table public.drawing_markers add constraint drawing_markers_kind_check check (kind in (
  'keypad', 'touch_panel', 'access_point', 'speaker', 'subwoofer', 'tv', 'camera', 'sensor', 'data_point', 'intercom', 'phone', 'light',
  'shade', 'lighting_panel', 'rack', 'other'));

alter table public.drawing_layers drop constraint drawing_layers_kind_check;
alter table public.drawing_layers add constraint drawing_layers_kind_check check (kind is null or kind in (
  'keypad', 'touch_panel', 'access_point', 'speaker', 'subwoofer', 'tv', 'camera', 'sensor', 'data_point', 'intercom', 'phone', 'light',
  'shade', 'lighting_panel', 'rack', 'other'));

alter table public.drawing_markers add column rack_id uuid references public.site_racks (id) on delete set null;
create index drawing_markers_rack on public.drawing_markers (rack_id) where rack_id is not null;

create or replace function public.guard_drawing_marker_rack()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.rack_id is not null and not exists (select 1 from public.site_racks r where r.id = new.rack_id and r.project_id = new.project_id) then
    raise exception 'Rack not found' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_drawing_marker_rack() from public, anon, authenticated;
create trigger drawing_markers_rack before insert or update of rack_id on public.drawing_markers for each row execute function public.guard_drawing_marker_rack();
