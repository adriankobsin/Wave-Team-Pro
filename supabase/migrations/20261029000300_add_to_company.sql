-- Put someone who already has an account straight into another company: no invitation, no Join
-- button. The caller needs users.invite there and must hold every permission of the role given
-- (same rule as inviting), and must already see that person in one of their own companies.
create or replace function public.add_to_company(p_org uuid, p_user uuid, p_role uuid, p_job_title text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.organization_memberships%rowtype;
  v_membership uuid;
  v_email text;
  v_slug text;
  v_name text;
begin
  if not public.has_permission(p_org, 'users.invite') then
    raise exception 'You can''t add people to that company' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where id = p_role and organization_id = p_org) then
    raise exception 'Choose a role in that company' using errcode = '22023';
  end if;
  perform public.assert_holds_role_permissions(p_org, p_role, 'organization', null);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_user and m.organization_id <> p_org and public.has_permission(m.organization_id, 'users.view')
  ) then
    raise exception 'You can only add people from your own companies' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then
    raise exception 'That account is deactivated' using errcode = '22023';
  end if;
  select o.slug, o.name into v_slug, v_name from public.organizations o where o.id = p_org and o.status = 'active';
  if v_slug is null then
    raise exception 'That company is not available' using errcode = '22023';
  end if;

  perform set_config('wbh.trusted_op', 'on', true);

  select * into v_existing from public.organization_memberships where organization_id = p_org and user_id = p_user;
  if found then
    if v_existing.status = 'active' then
      perform set_config('wbh.trusted_op', 'off', true);
      return v_existing.id;
    end if;
    update public.organization_memberships
      set status = 'active', deactivated_at = null, deactivated_by = null, job_title = coalesce(p_job_title, job_title)
      where id = v_existing.id;
    v_membership := v_existing.id;
  else
    insert into public.organization_memberships (organization_id, user_id, job_title, start_date)
    values (p_org, p_user, p_job_title, current_date)
    returning id into v_membership;
  end if;

  insert into public.membership_role_assignments (organization_id, membership_id, role_id, scope_type, granted_by)
  values (p_org, v_membership, p_role, 'organization', auth.uid())
  on conflict do nothing;

  -- Any invitation waiting for them in this company is done.
  select lower(email) into v_email from auth.users where id = p_user;
  update public.invitations set status = 'accepted', accepted_by = p_user, accepted_at = now()
    where organization_id = p_org and status = 'pending' and lower(email::text) = v_email;

  insert into public.notifications (organization_id, user_id, kind, title, body, link, actor_id)
  values (p_org, p_user, 'invitation', 'You''ve been added to ' || v_name, 'It''s now in your company list.', '/o/' || v_slug, auth.uid());

  perform set_config('wbh.trusted_op', 'off', true);
  return v_membership;
end;
$$;

revoke all on function public.add_to_company(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.add_to_company(uuid, uuid, uuid, text) to authenticated;

-- A pending invitation for someone who already has an account: add them now instead.
create or replace function public.add_invited_now(p_invitation uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_user uuid;
begin
  select * into v_inv from public.invitations where id = p_invitation and status = 'pending';
  if v_inv.id is null then
    raise exception 'That invitation is no longer pending' using errcode = 'P0002';
  end if;
  select id into v_user from auth.users where lower(email) = lower(v_inv.email::text);
  if v_user is null then
    raise exception 'They haven''t registered yet. Send them the link instead.' using errcode = 'P0002';
  end if;
  return public.add_to_company(v_inv.organization_id, v_user, v_inv.role_id, v_inv.job_title);
end;
$$;

revoke all on function public.add_invited_now(uuid) from public, anon;
grant execute on function public.add_invited_now(uuid) to authenticated;
