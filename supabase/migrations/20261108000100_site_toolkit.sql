-- Project site toolkit: network devices, cables / patch panels, switch ports, VLANs and IPs, racks,
-- Lutron integration (devices, buttons, LEDs, zones, areas, scenes) and lighting loads, plus GA drawings.
-- The project team views and updates (tests, statuses, labels); every change is kept in site_changes.
-- Credentials from customer spreadsheets are never stored here.

create table public.site_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  import_key text not null,
  deck text, room text, location text, system text, type text,
  name text not null check (char_length(name) between 1 and 200),
  model text, hostname text, port text, poe_w numeric(8, 2), mac text, serial text, ip text, firmware text,
  switch_port text, type_code text, cable_label text, patch_panel text, patch_port int, notes text,
  status text not null default 'planned' check (status in ('planned', 'delivered', 'installed', 'commissioned', 'tested', 'fault')),
  status_by uuid references public.profiles (id), status_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, import_key)
);

create table public.site_cables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  label text check (label is null or char_length(label) <= 120),
  rack text, patch_panel text not null, port int not null,
  cable_type text, system text, deck text, room text, location text, switch_port text, device_name text,
  device_id uuid references public.site_devices (id) on delete set null,
  installed boolean not null default false,
  test_result text not null default 'not_tested' check (test_result in ('not_tested', 'passed', 'failed', 'needs_review', 'retest')),
  length_m numeric(8, 2) check (length_m is null or length_m >= 0),
  tested_on date, tested_by uuid references public.profiles (id), tested_by_name text,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, patch_panel, port)
);
create index site_cables_label_idx on public.site_cables (project_id, label);

create table public.site_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  sheet text not null, title text, hostname text, model text, mac text, serial text, firmware text, location text, ip text, poe_total_w numeric(8, 2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, sheet)
);

create table public.site_ports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  equipment text not null, port text not null, position int not null default 0,
  vlan text, patch_port text, end_location text, end_device text, poe_w numeric(8, 2), end_ip text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, equipment, port)
);

create table public.site_vlans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  vlan_id int not null check (vlan_id between 1 and 4094), name text not null,
  ip_range text, subnet_mask text, gateway text, dns text, dhcp_scope text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, vlan_id)
);

create table public.site_ips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  vlan_id int, address text not null, device_name text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, address)
);

create table public.site_rack_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  rack text not null, unit int not null, item text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, rack, unit)
);

create table public.lutron_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  kind text not null check (kind in ('device', 'button', 'led', 'zone', 'area', 'scene', 'shade_group', 'hvac_zone', 'other')),
  path text not null, href text not null, integration_id int not null,
  model text, component text, component_name text, device_href text,
  engraving text check (engraving is null or char_length(engraving) <= 200),
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, href)
);
create index lutron_items_kind_idx on public.lutron_items (project_id, kind);

create table public.lighting_loads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  area text not null, zone_number int, zone_name text not null, zone_description text,
  load_number int, feed text, fixture text, quantity int, load_type text,
  assigned_to text, panel text, module text, output text, wattage numeric(10, 2),
  zone_href text,
  dali_address text check (dali_address is null or char_length(dali_address) <= 20),
  driver text,
  status text not null default 'planned' check (status in ('planned', 'delivered', 'installed', 'commissioned', 'tested', 'fault')),
  status_by uuid references public.profiles (id), status_at timestamptz,
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (project_id, area, zone_name, load_number)
);

create table public.project_drawings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  discipline text not null default 'general' check (discipline in ('general', 'lighting', 'control', 'av', 'wifi', 'data', 'cctv', 'access', 'audio', 'power', 'other')),
  number text check (number is null or char_length(number) <= 80),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  revision text check (revision is null or char_length(revision) <= 20),
  deck text,
  storage_path text not null unique, file_name text not null, size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid not null references public.profiles (id),
  supersedes uuid references public.project_drawings (id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index project_drawings_project_idx on public.project_drawings (project_id, discipline);

-- Every change to a row: which fields, old and new value, who and when.
create table public.site_changes (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete restrict,
  table_name text not null,
  row_id uuid not null,
  changes jsonb not null,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);
create index site_changes_row_idx on public.site_changes (row_id, changed_at desc);

create table public.site_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  kind text not null check (kind in ('network', 'lutron_integration', 'lutron_loads')),
  file_name text not null, counts jsonb not null default '{}', imported_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create or replace function public.guard_site_row()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select organization_id into new.organization_id from public.projects where id = new.project_id;
    if new.organization_id is null then
      raise exception 'Project not found' using errcode = '23503';
    end if;
  elsif new.project_id <> old.project_id or new.organization_id <> old.organization_id then
    raise exception 'A row cannot move to another project' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_site_row() from public, anon, authenticated;

create or replace function public.track_site_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old) - 'updated_at' - 'created_at';
  v_new jsonb := to_jsonb(new) - 'updated_at' - 'created_at';
  v_diff jsonb := '{}';
  k text;
begin
  for k in select jsonb_object_keys(v_new) loop
    if v_new -> k is distinct from v_old -> k then
      v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
    end if;
  end loop;
  if v_diff <> '{}' then
    insert into public.site_changes (project_id, table_name, row_id, changes, changed_by)
    values (new.project_id, tg_table_name, new.id, v_diff, auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function public.track_site_changes() from public, anon, authenticated;

create trigger site_devices_guard before insert or update on public.site_devices for each row execute function public.guard_site_row();
create trigger site_cables_guard before insert or update on public.site_cables for each row execute function public.guard_site_row();
create trigger site_equipment_guard before insert or update on public.site_equipment for each row execute function public.guard_site_row();
create trigger site_ports_guard before insert or update on public.site_ports for each row execute function public.guard_site_row();
create trigger site_vlans_guard before insert or update on public.site_vlans for each row execute function public.guard_site_row();
create trigger site_ips_guard before insert or update on public.site_ips for each row execute function public.guard_site_row();
create trigger site_rack_units_guard before insert or update on public.site_rack_units for each row execute function public.guard_site_row();
create trigger lutron_items_guard before insert or update on public.lutron_items for each row execute function public.guard_site_row();
create trigger lighting_loads_guard before insert or update on public.lighting_loads for each row execute function public.guard_site_row();
create trigger project_drawings_guard before insert or update on public.project_drawings for each row execute function public.guard_site_row();
create trigger site_imports_guard before insert on public.site_imports for each row execute function public.guard_site_row();

create trigger site_devices_track after update on public.site_devices for each row execute function public.track_site_changes();
create trigger site_cables_track after update on public.site_cables for each row execute function public.track_site_changes();
create trigger lutron_items_track after update on public.lutron_items for each row execute function public.track_site_changes();
create trigger lighting_loads_track after update on public.lighting_loads for each row execute function public.track_site_changes();
create trigger site_ports_track after update on public.site_ports for each row execute function public.track_site_changes();

-- Access: the project team sees and updates; whoever edits the project imports and removes.
alter table public.site_devices enable row level security;
alter table public.site_cables enable row level security;
alter table public.site_equipment enable row level security;
alter table public.site_ports enable row level security;
alter table public.site_vlans enable row level security;
alter table public.site_ips enable row level security;
alter table public.site_rack_units enable row level security;
alter table public.lutron_items enable row level security;
alter table public.lighting_loads enable row level security;
alter table public.project_drawings enable row level security;
alter table public.site_changes enable row level security;
alter table public.site_imports enable row level security;

create policy site_devices_select on public.site_devices for select to authenticated using (public.can_view_project(project_id));
create policy site_devices_insert on public.site_devices for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_devices_update on public.site_devices for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy site_cables_select on public.site_cables for select to authenticated using (public.can_view_project(project_id));
create policy site_cables_insert on public.site_cables for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_cables_update on public.site_cables for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy site_equipment_select on public.site_equipment for select to authenticated using (public.can_view_project(project_id));
create policy site_equipment_insert on public.site_equipment for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_equipment_update on public.site_equipment for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy site_ports_select on public.site_ports for select to authenticated using (public.can_view_project(project_id));
create policy site_ports_insert on public.site_ports for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_ports_update on public.site_ports for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy site_vlans_select on public.site_vlans for select to authenticated using (public.can_view_project(project_id));
create policy site_vlans_insert on public.site_vlans for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_vlans_update on public.site_vlans for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy site_ips_select on public.site_ips for select to authenticated using (public.can_view_project(project_id));
create policy site_ips_insert on public.site_ips for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_ips_update on public.site_ips for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy site_rack_units_select on public.site_rack_units for select to authenticated using (public.can_view_project(project_id));
create policy site_rack_units_insert on public.site_rack_units for insert to authenticated with check (public.can_edit_project(project_id));
create policy site_rack_units_update on public.site_rack_units for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy lutron_items_select on public.lutron_items for select to authenticated using (public.can_view_project(project_id));
create policy lutron_items_insert on public.lutron_items for insert to authenticated with check (public.can_edit_project(project_id));
create policy lutron_items_update on public.lutron_items for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy lighting_loads_select on public.lighting_loads for select to authenticated using (public.can_view_project(project_id));
create policy lighting_loads_insert on public.lighting_loads for insert to authenticated with check (public.can_edit_project(project_id));
create policy lighting_loads_update on public.lighting_loads for update to authenticated using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
create policy project_drawings_select on public.project_drawings for select to authenticated using (public.can_view_project(project_id));
create policy project_drawings_insert on public.project_drawings for insert to authenticated with check (public.can_log_on_project(project_id) and uploaded_by = auth.uid());
create policy project_drawings_update on public.project_drawings for update to authenticated using (public.can_edit_project(project_id) or uploaded_by = auth.uid()) with check (public.can_edit_project(project_id) or uploaded_by = auth.uid());
create policy site_changes_select on public.site_changes for select to authenticated using (public.can_view_project(project_id));
create policy site_imports_select on public.site_imports for select to authenticated using (public.can_view_project(project_id));
create policy site_imports_insert on public.site_imports for insert to authenticated with check (public.can_edit_project(project_id) and imported_by = auth.uid());

grant select, insert, update on public.site_devices, public.site_cables, public.site_equipment, public.site_ports, public.site_vlans,
  public.site_ips, public.site_rack_units, public.lutron_items, public.lighting_loads, public.project_drawings to authenticated;
grant select on public.site_changes to authenticated;
grant select, insert on public.site_imports to authenticated;
-- Project and company never change on a row (enforced by guard_site_row).
