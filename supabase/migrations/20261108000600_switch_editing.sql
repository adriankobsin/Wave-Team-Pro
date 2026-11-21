-- Switches, routers, firewalls and PBX: the project team can type into the port rows and the
-- switch details, add switches and ports by hand. Removing them stays with the project manager.

alter policy site_equipment_insert on public.site_equipment with check (public.can_log_on_project(project_id));
alter policy site_equipment_update on public.site_equipment
  using (public.can_log_on_project(project_id)) with check (public.can_log_on_project(project_id));
alter policy site_ports_insert on public.site_ports with check (public.can_log_on_project(project_id));

create trigger site_equipment_archive before update on public.site_equipment for each row execute function public.guard_site_archive();
create trigger site_ports_archive before update on public.site_ports for each row execute function public.guard_site_archive();
create trigger site_equipment_track after update on public.site_equipment for each row execute function public.track_site_changes();

alter table public.site_equipment
  add constraint site_equipment_sheet_len check (char_length(btrim(sheet)) between 1 and 80);
alter table public.site_ports
  add constraint site_ports_port_len check (char_length(btrim(port)) between 1 and 40);
