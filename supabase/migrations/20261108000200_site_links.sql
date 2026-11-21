-- After an import: tie each cable to the device on its patch panel port, and each lighting load to
-- its Lutron zone (so the load schedule shows the zone's integration address).
create or replace function public.link_site_records(p_project uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_cables int; v_loads int;
begin
  if not public.can_edit_project(p_project) then
    raise exception 'Only the project manager can do this' using errcode = '42501';
  end if;
  perform set_config('wbh.trusted_op', 'on', true);
  update public.site_cables c set device_id = d.id, device_name = coalesce(c.device_name, d.name)
    from public.site_devices d
    where c.project_id = p_project and d.project_id = p_project and d.archived_at is null
      and d.patch_panel = c.patch_panel and d.patch_port = c.port and c.device_id is distinct from d.id;
  get diagnostics v_cables = row_count;
  update public.lighting_loads l set zone_href = z.href
    from public.lutron_items z
    where l.project_id = p_project and z.project_id = p_project and z.kind = 'zone'
      and z.path = l.area || '\' || l.zone_name and l.zone_href is distinct from z.href;
  get diagnostics v_loads = row_count;
  perform set_config('wbh.trusted_op', 'off', true);
  return jsonb_build_object('cables', v_cables, 'loads', v_loads);
end;
$$;
revoke all on function public.link_site_records(uuid) from public, anon;
grant execute on function public.link_site_records(uuid) to authenticated;

-- GA drawings (A0/A1 PDFs) can be large: allow up to 50 MB per file in the private bucket.
update storage.buckets set file_size_limit = 52428800 where id = 'files';
