-- Wave Team Pro — private avatar bucket.
-- Writes happen only from the server (service role) after the image has been decoded,
-- cropped and re-encoded without metadata. Reads require sharing an active organization
-- with the avatar's owner and go through short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_view_avatar_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  begin
    v_owner := split_part(p_name, '/', 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_owner = auth.uid() then
    return true;
  end if;
  -- Only the avatar currently on the profile is shared; replaced files are not.
  return public.shares_active_org(v_owner) and exists (
    select 1 from public.profiles p
    where p.id = v_owner and (p.avatar_path = p_name or p.avatar_thumb_path = p_name)
  );
end;
$$;

-- Hosted Supabase grants EXECUTE to anon on new functions; close it explicitly.
revoke execute on function public.can_view_avatar_object(text) from public, anon;
grant execute on function public.can_view_avatar_object(text) to authenticated;

create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_view_avatar_object(name));

-- No insert/update/delete policies for end users: uploads go through the server.
