-- Existing companies: Employees become basic accounts (no project list, no document uploads).
-- Management can still grant either one to a person under Admin → Members → Individual exceptions.
select set_config('wbh.trusted_op', 'on', true);
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id and r.key = 'employee' and rp.permission_key in ('projects.view', 'documents.upload');
select set_config('wbh.trusted_op', 'off', true);
