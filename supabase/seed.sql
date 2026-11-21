-- Synthetic demo data for LOCAL development only (`supabase db reset` runs this file).
-- Never run against staging or production. All people and emails are fictional.
-- Password for every demo account: DemoPass-2026!

create or replace function pg_temp.demo_user(p_email text, p_name text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt('DemoPass-2026!', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now());
  return v_id;
end $$;

do $$
declare
  v_owner uuid := pg_temp.demo_user('owner@demo.test', 'Platform Owner');
  v_alice uuid := pg_temp.demo_user('alice@demo.test', 'Alice Mercer');
  v_bob   uuid := pg_temp.demo_user('bob@demo.test', 'Bob Tanaka');
  v_ioana uuid := pg_temp.demo_user('ioana@demo.test', 'Ioana Popescu');
  v_org uuid;
  v_inv uuid;
begin
  insert into public.platform_admins (user_id) values (v_owner);

  -- Platform owner provisions the organization and invites its first Super Admin.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_org := public.create_organization('Acme Demo Co', 'demo', 'GBP', 'Europe/London', 'GB', 'DEMO-001');
  v_inv := public.create_initial_invitation(v_org, 'alice@demo.test', 'Alice Mercer');

  -- Alice accepts, then sets up structure and invites colleagues (guards run as Alice).
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform public.accept_invitation(v_inv);
  insert into public.departments (organization_id, name, code)
    values (v_org, 'Engineering', 'ENG'), (v_org, 'Operations', 'OPS');
  insert into public.teams (organization_id, name, department_id)
    select v_org, 'Refit crew', id from public.departments where organization_id = v_org and code = 'ENG';
  insert into public.invitations (organization_id, email, display_name, role_id, job_title, expires_at)
    select v_org, 'bob@demo.test', 'Bob Tanaka', id, 'AV/IT Engineer', now()
    from public.roles where organization_id = v_org and key = 'employee';
  insert into public.invitations (organization_id, email, display_name, role_id, job_title, expires_at)
    select v_org, 'ioana@demo.test', 'Ioana Popescu', id, 'Bookkeeper', now()
    from public.roles where organization_id = v_org and key = 'bookkeeper';

  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  perform public.accept_invitation((select id from public.invitations where email = 'bob@demo.test' and status = 'pending'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_ioana, 'role', 'authenticated')::text, true);
  perform public.accept_invitation((select id from public.invitations where email = 'ioana@demo.test' and status = 'pending'));
  perform set_config('request.jwt.claims', '', true);
end $$;
