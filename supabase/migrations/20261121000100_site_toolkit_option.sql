-- Optional systems-integration toolkit (site imports, cables, devices, switches, VLANs, racks,
-- lighting loads, Lutron integration, drawings, QR labels). Off for new companies; a company
-- admin turns it on in Admin → Settings → Modules.
alter table public.organization_settings
  add column site_toolkit_enabled boolean not null default false;

grant update (site_toolkit_enabled) on public.organization_settings to authenticated;
