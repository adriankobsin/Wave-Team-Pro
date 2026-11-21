-- Site editing: manual devices with manufacturer, rack layouts with movable multi-U items,
-- and device markers placed on drawings.

-- ---------------------------------------------------------------- devices
alter table public.site_devices add column if not exists manufacturer text check (manufacturer is null or char_length(manufacturer) <= 80);

update public.site_devices set manufacturer = case
  when model ~* '^(C9|CW9|IW9|C98)' then 'Cisco'
  when model ilike 'peplink%' then 'Peplink'
  when model ilike 'ucm%' then 'Grandstream'
  when model ilike 'fortigate%' then 'Fortinet'
end
where manufacturer is null and model is not null;

-- Technicians on the project can add devices by hand; removing stays with whoever edits the project.
alter policy site_devices_insert on public.site_devices with check (public.can_log_on_project(project_id));

create or replace function public.guard_site_archive()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at and auth.uid() is not null and not public.can_edit_project(new.project_id) then
    raise exception 'Only the project manager can remove this' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_site_archive() from public, anon, authenticated;
create trigger site_devices_archive before update on public.site_devices for each row execute function public.guard_site_archive();
create trigger site_cables_archive before update on public.site_cables for each row execute function public.guard_site_archive();

-- ---------------------------------------------------------------- racks
create table public.site_racks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  units int not null default 42 check (units between 1 and 60),
  location text check (location is null or char_length(location) <= 120),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create unique index site_racks_name on public.site_racks (project_id, lower(name)) where archived_at is null;

create table public.site_rack_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  rack_id uuid not null references public.site_racks (id) on delete cascade,
  u_bottom int not null check (u_bottom >= 1),
  u_size int not null default 1 check (u_size between 1 and 20),
  kind text not null default 'equipment' check (kind in ('equipment', 'patch_panel', 'brush', 'switch', 'ups', 'pdu', 'shelf', 'blank', 'fan', 'other')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  manufacturer text check (manufacturer is null or char_length(manufacturer) <= 80),
  model text check (model is null or char_length(model) <= 120),
  device_id uuid references public.site_devices (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index site_rack_items_rack on public.site_rack_items (rack_id, u_bottom);
create index site_rack_items_device on public.site_rack_items (device_id) where device_id is not null;

-- An item must fit inside its rack, not overlap another, and stay in its rack's project.
create or replace function public.guard_rack_item()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_units int; v_project uuid; v_clash text;
begin
  select units, project_id into v_units, v_project from public.site_racks where id = new.rack_id and archived_at is null;
  if v_units is null or v_project <> new.project_id then
    raise exception 'Rack not found' using errcode = '23503';
  end if;
  if new.u_bottom + new.u_size - 1 > v_units then
    raise exception 'It doesn''t fit: the rack has % U', v_units using errcode = '23514';
  end if;
  select label into v_clash from public.site_rack_items i
  where i.rack_id = new.rack_id and i.id <> new.id
    and i.u_bottom <= new.u_bottom + new.u_size - 1 and new.u_bottom <= i.u_bottom + i.u_size - 1
  limit 1;
  if v_clash is not null then
    raise exception 'That space is taken by %', v_clash using errcode = '23514';
  end if;
  if new.device_id is not null and not exists (select 1 from public.site_devices d where d.id = new.device_id and d.project_id = new.project_id) then
    raise exception 'Device not found' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_rack_item() from public, anon, authenticated;

create trigger site_racks_guard before insert or update on public.site_racks for each row execute function public.guard_site_row();
create trigger site_racks_archive before update on public.site_racks for each row execute function public.guard_site_archive();
create trigger site_rack_items_guard before insert or update on public.site_rack_items for each row execute function public.guard_site_row();
create trigger site_rack_items_fit before insert or update on public.site_rack_items for each row execute function public.guard_rack_item();

alter table public.site_racks enable row level security;
alter table public.site_rack_items enable row level security;
create policy site_racks_select on public.site_racks for select to authenticated using (public.can_view_project(project_id));
create policy site_racks_insert on public.site_racks for insert to authenticated with check (public.can_log_on_project(project_id));
create policy site_racks_update on public.site_racks for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy site_rack_items_select on public.site_rack_items for select to authenticated using (public.can_view_project(project_id));
create policy site_rack_items_insert on public.site_rack_items for insert to authenticated with check (public.can_log_on_project(project_id));
create policy site_rack_items_update on public.site_rack_items for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy site_rack_items_delete on public.site_rack_items for delete to authenticated using (public.can_log_on_project(project_id));
grant select, insert, update on public.site_racks to authenticated;
grant select, insert, update, delete on public.site_rack_items to authenticated;

-- Builds editable racks from the imported rack sheet (once per rack name): runs of the same
-- item become one multi-U item (UPS whole; other gear in 2U pieces), blanks are left empty.
create or replace function public.seed_rack_layout(p_project uuid)
returns int language plpgsql set search_path = ''
as $$
declare
  r record; u record;
  v_rack uuid; v_count int := 0;
  v_label text; v_start int; v_len int; v_prev int;
  v_kind text; v_chunk int;
begin
  for r in
    select rack, max(unit) as top from public.site_rack_units
    where project_id = p_project and archived_at is null
      and not exists (select 1 from public.site_racks s where s.project_id = p_project and lower(s.name) = lower(rack) and s.archived_at is null)
    group by rack order by rack
  loop
    insert into public.site_racks (project_id, name, units) values (p_project, r.rack, case when r.top > 12 then greatest(r.top, 42) else r.top end)
    returning id into v_rack;
    v_count := v_count + 1;
    v_label := null;
    for u in
      select unit, btrim(item) as item from public.site_rack_units
      where project_id = p_project and rack = r.rack and archived_at is null
      union all select 1000, null
      order by 1
    loop
      if v_label is not null and (u.item is distinct from v_label or u.unit <> v_prev + 1) then
        v_kind := case
          when v_label ~* 'brush' then 'brush'
          when v_label ~* 'patch' then 'patch_panel'
          when v_label ~* '\mups\M' then 'ups'
          when v_label ~* '\mpdu\M' then 'pdu'
          when v_label ~* 'shelf' then 'shelf'
          when v_label ~* '(c9300|c9200|switch)' then 'switch'
          else 'equipment' end;
        v_chunk := case when v_kind = 'ups' then v_len when v_kind in ('brush', 'patch_panel', 'pdu', 'switch') then 1 else 2 end;
        while v_len > 0 loop
          insert into public.site_rack_items (project_id, rack_id, u_bottom, u_size, kind, label, manufacturer)
          values (p_project, v_rack, v_start, least(v_chunk, v_len), v_kind, v_label, case split_part(upper(v_label), ' ', 1)
            when 'CISCO' then 'Cisco' when 'QSYS' then 'Q-SYS' when 'CRESTRON' then 'Crestron' when 'APC' then 'APC' when 'LINDY' then 'Lindy'
            when 'PEPLINK' then 'Peplink' when 'FORTIGATE' then 'Fortinet' when 'DELL' then 'Dell' when 'AXIS' then 'Axis'
            when 'GRANDSTREAM' then 'Grandstream' when 'SYNOLOGY' then 'Synology' when 'APPLE' then 'Apple' else null end);
          v_start := v_start + least(v_chunk, v_len);
          v_len := v_len - v_chunk;
        end loop;
        v_label := null;
      end if;
      if u.item is not null and upper(u.item) <> 'BLANK' and u.item <> '' then
        if v_label is null then v_label := u.item; v_start := u.unit; v_len := 1;
        else v_len := v_len + 1; end if;
      end if;
      v_prev := u.unit;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.seed_rack_layout(uuid) from public, anon;
grant execute on function public.seed_rack_layout(uuid) to authenticated;

do $$
declare p uuid;
begin
  for p in select distinct project_id from public.site_rack_units loop
    perform public.seed_rack_layout(p);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- drawing markers
create table public.drawing_markers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  drawing_id uuid not null references public.project_drawings (id) on delete cascade,
  page int not null default 1 check (page >= 1),
  x numeric(7, 6) not null check (x between 0 and 1),
  y numeric(7, 6) not null check (y between 0 and 1),
  kind text not null check (kind in ('keypad', 'touch_panel', 'access_point', 'speaker', 'subwoofer', 'tv', 'camera', 'sensor', 'data_point', 'intercom', 'phone', 'light', 'other')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  device_id uuid references public.site_devices (id) on delete set null,
  lutron_item_id uuid references public.lutron_items (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index drawing_markers_drawing on public.drawing_markers (drawing_id, page);

create or replace function public.guard_drawing_marker()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.project_drawings d where d.id = new.drawing_id and d.project_id = new.project_id) then
    raise exception 'Drawing not found' using errcode = '23503';
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
revoke all on function public.guard_drawing_marker() from public, anon, authenticated;
create trigger drawing_markers_guard before insert or update on public.drawing_markers for each row execute function public.guard_site_row();
create trigger drawing_markers_check before insert or update on public.drawing_markers for each row execute function public.guard_drawing_marker();

alter table public.drawing_markers enable row level security;
create policy drawing_markers_select on public.drawing_markers for select to authenticated using (public.can_view_project(project_id));
create policy drawing_markers_insert on public.drawing_markers for insert to authenticated with check (public.can_log_on_project(project_id));
create policy drawing_markers_update on public.drawing_markers for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy drawing_markers_delete on public.drawing_markers for delete to authenticated using (public.can_log_on_project(project_id));
grant select, insert, update, delete on public.drawing_markers to authenticated;
