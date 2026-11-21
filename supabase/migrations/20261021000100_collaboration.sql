-- Wave Team Pro — Phase B: files, chat, announcements, documents, notifications.
--
-- Files: every uploaded object (chat attachment, document version, receipt) has a row in
-- public.files. The row records which business object it belongs to (context_type/context_id);
-- whether a person may read the file is decided by whether they may read that object.
-- The storage policy simply asks "can you see the files row for this path?", so storage
-- access always follows table RLS.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.my_user_id()
returns uuid language sql stable set search_path = '' as $$ select auth.uid(); $$;

-- Team ids (active, not archived) that the caller belongs to in an organization.
create or replace function public.my_team_ids(p_org uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select tm.team_id
  from public.team_memberships tm
  join public.teams t on t.id = tm.team_id and t.archived_at is null
  where tm.membership_id = public.my_membership_id(p_org);
$$;

create or replace function public.user_membership_id(p_org uuid, p_user uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.organization_memberships
  where organization_id = p_org and user_id = p_user and status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  bucket text not null default 'files' check (bucket = 'files'),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  context_type text not null check (context_type in ('message', 'document', 'expense', 'task', 'announcement')),
  context_id uuid not null,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (storage_path like organization_id::text || '/%')
);

create index files_context_idx on public.files (context_type, context_id);
create index files_org_hash_idx on public.files (organization_id, sha256);

-- ---------------------------------------------------------------------------
-- Conversations (direct, group, channel)
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  type text not null check (type in ('direct', 'group', 'channel')),
  name text check (name is null or char_length(btrim(name)) between 1 and 80),
  topic text check (topic is null or char_length(topic) <= 300),
  -- Channels can be open to the whole organization or a team; their members are implicit.
  audience text not null default 'members' check (audience in ('members', 'organization', 'team')),
  team_id uuid,
  direct_key text,
  created_by uuid references public.profiles (id),
  archived_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, direct_key),
  check ((type = 'direct') = (direct_key is not null)),
  check (type = 'channel' or audience = 'members'),
  check ((audience = 'team') = (team_id is not null)),
  check (type = 'direct' or name is not null),
  foreign key (team_id, organization_id) references public.teams (id, organization_id) on delete restrict
);

create index conversations_org_last_idx on public.conversations (organization_id, last_message_at desc);

create table public.conversation_members (
  conversation_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role text not null default 'member' check (role in ('member', 'owner')),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  foreign key (conversation_id, organization_id) references public.conversations (id, organization_id) on delete cascade
);

create index conversation_members_user_idx on public.conversation_members (user_id);

create or replace function public.can_read_conversation(p_conv uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  c record;
begin
  select id, organization_id, type, audience, team_id, archived_at into c
  from public.conversations where id = p_conv;
  if not found or not public.is_org_member(c.organization_id) then
    return false;
  end if;
  if exists (select 1 from public.conversation_members m where m.conversation_id = p_conv and m.user_id = auth.uid()) then
    return true;
  end if;
  if c.type = 'channel' and c.audience = 'organization' then
    return true;
  end if;
  if c.type = 'channel' and c.audience = 'team' then
    return c.team_id in (select public.my_team_ids(c.organization_id));
  end if;
  return false;
end;
$$;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  parent_id uuid references public.messages (id) on delete set null,
  body text not null default '' check (char_length(body) <= 8000),
  mentions uuid[] not null default '{}',
  pinned_at timestamptz,
  pinned_by uuid references public.profiles (id),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, organization_id) references public.conversations (id, organization_id) on delete cascade
);

create index messages_conv_created_idx on public.messages (conversation_id, created_at desc);
create index messages_parent_idx on public.messages (parent_id);
create index messages_body_search_idx on public.messages using gin (to_tsvector('simple', body));

create table public.message_attachments (
  message_id uuid not null references public.messages (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete restrict,
  primary key (message_id, file_id)
);

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🎉', '👀', '✅')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Message guard: authors post as themselves, only in conversations they can read; edits
-- are limited to the author's own body within 24 h; deletion is a soft delete.
create or replace function public.guard_message()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    new.pinned_at := null;
    new.pinned_by := null;
    if new.parent_id is not null and not exists (
      select 1 from public.messages p where p.id = new.parent_id and p.conversation_id = new.conversation_id
    ) then
      raise exception 'Reply must belong to the same conversation' using errcode = '23503';
    end if;
    return new;
  end if;
  if new.conversation_id <> old.conversation_id or new.author_id <> old.author_id
     or new.created_at <> old.created_at or new.organization_id <> old.organization_id then
    raise exception 'Message identity fields are immutable' using errcode = '42501';
  end if;
  if new.body is distinct from old.body or new.deleted_at is distinct from old.deleted_at then
    if old.author_id <> auth.uid() then
      raise exception 'Only the author can edit or delete a message' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      raise exception 'Deleted messages cannot be changed' using errcode = '42501';
    end if;
    if new.body is distinct from old.body then
      if old.created_at < now() - interval '24 hours' then
        raise exception 'Messages can only be edited for 24 hours' using errcode = '42501';
      end if;
      new.edited_at := now();
    end if;
    if new.deleted_at is not null then
      new.deleted_at := now();
      new.body := '';
    end if;
  end if;
  if new.pinned_at is distinct from old.pinned_at then
    new.pinned_by := case when new.pinned_at is null then null else auth.uid() end;
    new.pinned_at := case when new.pinned_at is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger messages_guard before insert or update on public.messages
  for each row execute function public.guard_message();

create or replace function public.touch_conversation()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  -- The author has read their own message.
  update public.conversation_members set last_read_at = new.created_at
    where conversation_id = new.conversation_id and user_id = new.author_id;
  return null;
end;
$$;

create trigger messages_touch after insert on public.messages
  for each row execute function public.touch_conversation();

-- Start (or reopen) a direct conversation between the caller and another active member.
create or replace function public.start_direct_conversation(p_org uuid, p_other uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  if p_other = v_me or public.user_membership_id(p_org, p_other) is null then
    raise exception 'That person is not available for messages' using errcode = '42501';
  end if;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  select id into v_id from public.conversations where organization_id = p_org and direct_key = v_key;
  if v_id is null then
    insert into public.conversations (organization_id, type, direct_key, created_by)
    values (p_org, 'direct', v_key, v_me) returning id into v_id;
    insert into public.conversation_members (conversation_id, organization_id, user_id, role)
    values (v_id, p_org, v_me, 'owner'), (v_id, p_org, p_other, 'member');
  end if;
  return v_id;
end;
$$;

-- Create a group or channel. Channels need chat.channel.create (at team scope for team channels).
create or replace function public.create_conversation(
  p_org uuid, p_type text, p_name text, p_topic text, p_audience text, p_team uuid, p_members uuid[]
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_user uuid;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  if p_type not in ('group', 'channel') then
    raise exception 'Use start_direct_conversation for direct messages' using errcode = '22023';
  end if;
  if p_type = 'channel' then
    if p_audience = 'team' then
      if not public.has_permission(p_org, 'chat.channel.create', 'team', p_team) then
        raise exception 'chat.channel.create permission required for this team' using errcode = '42501';
      end if;
    elsif not public.has_permission(p_org, 'chat.channel.create') then
      raise exception 'chat.channel.create permission required' using errcode = '42501';
    end if;
  end if;
  insert into public.conversations (organization_id, type, name, topic, audience, team_id, created_by)
  values (p_org, p_type, btrim(p_name), nullif(btrim(coalesce(p_topic, '')), ''),
          case when p_type = 'channel' then coalesce(p_audience, 'members') else 'members' end,
          case when p_type = 'channel' and p_audience = 'team' then p_team else null end, v_me)
  returning id into v_id;
  insert into public.conversation_members (conversation_id, organization_id, user_id, role)
  values (v_id, p_org, v_me, 'owner');
  foreach v_user in array coalesce(p_members, '{}') loop
    if v_user <> v_me and public.user_membership_id(p_org, v_user) is not null then
      insert into public.conversation_members (conversation_id, organization_id, user_id)
      values (v_id, p_org, v_user) on conflict do nothing;
    end if;
  end loop;
  return v_id;
end;
$$;

-- Owners of groups/channels (or channel moderators) add and remove members.
create or replace function public.can_manage_conversation(p_conv uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv and c.type <> 'direct'
      and (
        exists (select 1 from public.conversation_members m
                where m.conversation_id = c.id and m.user_id = auth.uid() and m.role = 'owner')
        or (c.type = 'channel' and public.has_permission(c.organization_id, 'chat.channel.moderate'))
      )
  );
$$;

create or replace function public.mark_conversation_read(p_conv uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not public.can_read_conversation(p_conv) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  select organization_id into v_org from public.conversations where id = p_conv;
  insert into public.conversation_members (conversation_id, organization_id, user_id, last_read_at)
  values (p_conv, v_org, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
end;
$$;

-- Inbox: conversations the caller can read, with unread counts and the other person for DMs.
create or replace function public.my_conversations(p_org uuid)
returns table (
  id uuid, type text, name text, topic text, audience text, team_id uuid, last_message_at timestamptz,
  unread_count bigint, last_body text, last_author uuid, other_user uuid, muted boolean
)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select c.* from public.conversations c
    where c.organization_id = p_org and c.archived_at is null and public.can_read_conversation(c.id)
  )
  select m.id, m.type, m.name, m.topic, m.audience, m.team_id, m.last_message_at,
    (select count(*) from public.messages x
       where x.conversation_id = m.id and x.deleted_at is null and x.author_id <> auth.uid()
         and x.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)) as unread_count,
    (select x.body from public.messages x where x.conversation_id = m.id and x.deleted_at is null
       order by x.created_at desc limit 1) as last_body,
    (select x.author_id from public.messages x where x.conversation_id = m.id and x.deleted_at is null
       order by x.created_at desc limit 1) as last_author,
    (select o.user_id from public.conversation_members o
       where m.type = 'direct' and o.conversation_id = m.id and o.user_id <> auth.uid() limit 1) as other_user,
    coalesce(cm.muted, false)
  from mine m
  left join public.conversation_members cm on cm.conversation_id = m.id and cm.user_id = auth.uid()
  order by m.last_message_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  body text not null check (char_length(body) between 1 and 10000),
  audience text not null default 'organization' check (audience in ('organization', 'team')),
  team_id uuid,
  requires_ack boolean not null default false,
  pinned boolean not null default false,
  expires_at timestamptz,
  published_by uuid not null references public.profiles (id),
  published_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  check ((audience = 'team') = (team_id is not null)),
  foreign key (team_id, organization_id) references public.teams (id, organization_id) on delete restrict
);

create index announcements_org_idx on public.announcements (organization_id, published_at desc);

create table public.announcement_acknowledgements (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- Row-based check (used by RLS so INSERT ... RETURNING works) plus an id-based wrapper.
create or replace function public.can_read_announcement_row(p_org uuid, p_audience text, p_team uuid, p_publisher uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_org_member(p_org)
    and (p_audience = 'organization'
         or p_team in (select public.my_team_ids(p_org))
         or p_publisher = auth.uid()
         or public.has_permission(p_org, 'announcements.publish'));
$$;

create or replace function public.can_read_announcement(p_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.can_read_announcement_row(a.organization_id, a.audience, a.team_id, a.published_by)
                   from public.announcements a where a.id = p_id), false);
$$;

create or replace function public.guard_announcement()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_trusted_db_context() then
    return new;
  end if;
  if new.audience = 'team' then
    if not public.has_permission(new.organization_id, 'announcements.publish', 'team', new.team_id) then
      raise exception 'announcements.publish permission required for this team' using errcode = '42501';
    end if;
  elsif not public.has_permission(new.organization_id, 'announcements.publish') then
    raise exception 'announcements.publish permission required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.published_by := auth.uid();
    new.published_at := now();
  elsif new.published_by <> old.published_by or new.organization_id <> old.organization_id then
    raise exception 'Publisher is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger announcements_guard before insert or update on public.announcements
  for each row execute function public.guard_announcement();

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  parent_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  scope text not null check (scope in ('organization', 'department', 'team', 'personal', 'hr')),
  scope_id uuid,
  owner_id uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((scope = 'personal') = (owner_id is not null)),
  check ((scope in ('department', 'team')) = (scope_id is not null)),
  foreign key (parent_id, organization_id) references public.folders (id, organization_id) on delete cascade
);

create index folders_org_idx on public.folders (organization_id, parent_id);

create or replace function public.can_read_folder_row(p_org uuid, p_scope text, p_scope_id uuid, p_owner uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_mid uuid;
begin
  v_mid := public.my_membership_id(p_org);
  if v_mid is null then return false; end if;
  if p_scope = 'personal' then return p_owner = auth.uid(); end if;
  if p_scope = 'hr' then return public.has_permission(p_org, 'hr.documents.manage'); end if;
  if public.has_permission(p_org, 'documents.manage') then return true; end if;
  if not (public.has_permission(p_org, 'documents.read')
          or (p_scope = 'team' and public.has_permission(p_org, 'documents.read', 'team', p_scope_id))) then
    return false;
  end if;
  if p_scope = 'organization' then return true; end if;
  if p_scope = 'team' then return p_scope_id in (select public.my_team_ids(p_org)); end if;
  if p_scope = 'department' then
    return exists (select 1 from public.organization_memberships m where m.id = v_mid and m.department_id = p_scope_id);
  end if;
  return false;
end;
$$;

create or replace function public.can_read_folder(p_folder uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.can_read_folder_row(f.organization_id, f.scope, f.scope_id, f.owner_id)
                   from public.folders f where f.id = p_folder and f.archived_at is null), false);
$$;

create or replace function public.can_write_folder(p_folder uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  f record;
begin
  select * into f from public.folders where id = p_folder and archived_at is null;
  if not found or not public.can_read_folder(p_folder) then return false; end if;
  if f.scope = 'personal' then return f.owner_id = auth.uid(); end if;
  if f.scope = 'hr' then return public.has_permission(f.organization_id, 'hr.documents.manage'); end if;
  return public.has_permission(f.organization_id, 'documents.upload')
      or public.has_permission(f.organization_id, 'documents.manage')
      or (f.scope = 'team' and public.has_permission(f.organization_id, 'documents.upload', 'team', f.scope_id));
end;
$$;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  folder_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  tags text[] not null default '{}',
  current_file_id uuid references public.files (id),
  current_version integer not null default 0,
  uploaded_by uuid not null references public.profiles (id),
  updated_by uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (folder_id, organization_id) references public.folders (id, organization_id) on delete restrict
);

create index documents_folder_idx on public.documents (folder_id, updated_at desc);
create index documents_search_idx on public.documents using gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null,
  file_id uuid not null references public.files (id) on delete restrict,
  note text check (note is null or char_length(note) <= 300),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

-- ---------------------------------------------------------------------------
-- Notifications (in-app). Created by triggers with SECURITY DEFINER; users only read
-- and mark their own as read.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null,
  title text not null,
  body text,
  link text check (link is null or link like '/%'),
  actor_id uuid references public.profiles (id),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create or replace function public.notify(
  p_org uuid, p_user uuid, p_kind text, p_title text, p_body text, p_link text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null or p_user = auth.uid() then
    return;
  end if;
  if public.user_membership_id(p_org, p_user) is null then
    return;
  end if;
  insert into public.notifications (organization_id, user_id, kind, title, body, link, actor_id)
  values (p_org, p_user, p_kind, left(p_title, 200), left(p_body, 300), p_link, auth.uid());
end;
$$;

revoke all on function public.notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.org_slug(p_org uuid)
returns text language sql stable security definer set search_path = ''
as $$ select slug::text from public.organizations where id = p_org; $$;

create or replace function public.display_name_of(p_user uuid)
returns text language sql stable security definer set search_path = ''
as $$ select display_name from public.profiles where id = p_user; $$;

-- Direct messages and @mentions notify recipients (unless they muted the conversation).
create or replace function public.notify_on_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_user uuid;
  v_name text := public.display_name_of(new.author_id);
  v_link text;
begin
  select * into c from public.conversations where id = new.conversation_id;
  v_link := '/o/' || public.org_slug(new.organization_id) || '/chat/' || new.conversation_id;
  if c.type in ('direct', 'group') then
    for v_user in
      select m.user_id from public.conversation_members m
      where m.conversation_id = c.id and m.user_id <> new.author_id and not m.muted
    loop
      perform public.notify(new.organization_id, v_user, 'message',
        case when c.type = 'direct' then v_name else v_name || ' in ' || c.name end,
        left(new.body, 140), v_link);
    end loop;
  end if;
  foreach v_user in array new.mentions loop
    if c.type = 'channel' and public.user_membership_id(new.organization_id, v_user) is not null then
      perform public.notify(new.organization_id, v_user, 'mention',
        v_name || ' mentioned you in #' || c.name, left(new.body, 140), v_link);
    end if;
  end loop;
  return null;
end;
$$;

create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_on_message();

create or replace function public.notify_on_announcement()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select m.user_id from public.organization_memberships m
    where m.organization_id = new.organization_id and m.status = 'active'
      and (new.audience = 'organization'
           or exists (select 1 from public.team_memberships tm where tm.membership_id = m.id and tm.team_id = new.team_id))
  loop
    perform public.notify(new.organization_id, v_user, 'announcement', new.title,
      case when new.requires_ack then 'Please read and acknowledge.' else null end,
      '/o/' || public.org_slug(new.organization_id) || '/announcements#a-' || new.id);
  end loop;
  return null;
end;
$$;

create trigger announcements_notify after insert on public.announcements
  for each row execute function public.notify_on_announcement();

-- ---------------------------------------------------------------------------
-- File access follows the object the file belongs to.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_file(p_file uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  f record;
begin
  select * into f from public.files where id = p_file;
  if not found or not public.is_org_member(f.organization_id) then return false; end if;
  if f.context_type = 'message' then
    return exists (select 1 from public.messages m where m.id = f.context_id and m.deleted_at is null
                   and public.can_read_conversation(m.conversation_id));
  elsif f.context_type = 'document' then
    return exists (select 1 from public.documents d where d.id = f.context_id and public.can_read_folder(d.folder_id));
  elsif f.context_type = 'announcement' then
    return public.can_read_announcement(f.context_id);
  elsif f.context_type in ('expense', 'task') then
    -- Defined by Phase C/D migrations (replaced there).
    return f.uploaded_by = auth.uid();
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.files enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_acknowledgements enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.notifications enable row level security;

-- files: read only; rows are written by the server after validating the upload.
grant select on public.files to authenticated;
create policy files_select on public.files for select to authenticated
  using (public.can_read_file(id));

grant select on public.conversations to authenticated;
grant update (name, topic, archived_at) on public.conversations to authenticated;
create policy conversations_select on public.conversations for select to authenticated
  using (public.can_read_conversation(id));
create policy conversations_update on public.conversations for update to authenticated
  using (public.can_manage_conversation(id)) with check (public.can_manage_conversation(id));

grant select, insert, delete on public.conversation_members to authenticated;
grant update (muted) on public.conversation_members to authenticated;
create policy conv_members_select on public.conversation_members for select to authenticated
  using (public.can_read_conversation(conversation_id));
create policy conv_members_insert on public.conversation_members for insert to authenticated
  with check (public.can_manage_conversation(conversation_id)
              and public.user_membership_id(organization_id, user_id) is not null);
create policy conv_members_delete on public.conversation_members for delete to authenticated
  using (user_id = auth.uid() or public.can_manage_conversation(conversation_id));
create policy conv_members_update on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert on public.messages to authenticated;
grant update (body, deleted_at, pinned_at) on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated
  using (public.can_read_conversation(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_read_conversation(conversation_id)
              and exists (select 1 from public.conversations c where c.id = conversation_id
                          and c.organization_id = messages.organization_id and c.archived_at is null));
create policy messages_update on public.messages for update to authenticated
  using (public.can_read_conversation(conversation_id))
  with check (public.can_read_conversation(conversation_id));

grant select on public.message_attachments to authenticated;
create policy message_attachments_select on public.message_attachments for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

grant select, insert, delete on public.message_reactions to authenticated;
create policy reactions_select on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
create policy reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and m.deleted_at is null));
create policy reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert on public.announcements to authenticated;
grant update (title, body, pinned, expires_at, archived_at, requires_ack) on public.announcements to authenticated;
create policy announcements_select on public.announcements for select to authenticated
  using (public.can_read_announcement_row(organization_id, audience, team_id, published_by));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy announcements_update on public.announcements for update to authenticated
  using (public.has_permission(organization_id, 'announcements.publish') or published_by = auth.uid())
  with check (public.is_org_member(organization_id));

grant select, insert on public.announcement_acknowledgements to authenticated;
create policy ack_select on public.announcement_acknowledgements for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.announcements a where a.id = announcement_id
      and (a.published_by = auth.uid() or public.has_permission(a.organization_id, 'announcements.publish'))));
create policy ack_insert on public.announcement_acknowledgements for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_announcement(announcement_id));

grant select, insert on public.folders to authenticated;
grant update (name, archived_at) on public.folders to authenticated;
create policy folders_select on public.folders for select to authenticated
  using (archived_at is null and public.can_read_folder_row(organization_id, scope, scope_id, owner_id));
create policy folders_insert on public.folders for insert to authenticated
  with check (
    public.is_org_member(organization_id) and created_by = auth.uid() and (
      (scope = 'personal' and owner_id = auth.uid())
      or (scope = 'hr' and public.has_permission(organization_id, 'hr.documents.manage'))
      or (scope in ('organization', 'department') and public.has_permission(organization_id, 'documents.manage'))
      or (scope = 'team' and (public.has_permission(organization_id, 'documents.manage')
                              or public.has_permission(organization_id, 'documents.manage', 'team', scope_id)))
    )
    and (parent_id is null or public.can_write_folder(parent_id))
  );
create policy folders_update on public.folders for update to authenticated
  using ((scope = 'personal' and owner_id = auth.uid()) or public.has_permission(organization_id, 'documents.manage')
         or (scope = 'hr' and public.has_permission(organization_id, 'hr.documents.manage')))
  with check (public.is_org_member(organization_id));

grant select on public.documents to authenticated;
grant update (title, description, tags, archived_at) on public.documents to authenticated;
create policy documents_select on public.documents for select to authenticated
  using (public.can_read_folder(folder_id) and (archived_at is null or public.has_permission(organization_id, 'documents.manage')));
create policy documents_update on public.documents for update to authenticated
  using (public.can_write_folder(folder_id) and (uploaded_by = auth.uid() or public.has_permission(organization_id, 'documents.manage')))
  with check (public.can_write_folder(folder_id));

grant select on public.document_versions to authenticated;
create policy document_versions_select on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage: a single private bucket; reading an object requires seeing its files row.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy files_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and exists (select 1 from public.files f where f.storage_path = name));

-- Function grants
grant execute on function public.my_team_ids(uuid) to authenticated;
grant execute on function public.user_membership_id(uuid, uuid) to authenticated;
grant execute on function public.my_user_id() to authenticated;
grant execute on function public.can_read_conversation(uuid) to authenticated;
grant execute on function public.can_manage_conversation(uuid) to authenticated;
grant execute on function public.start_direct_conversation(uuid, uuid) to authenticated;
grant execute on function public.create_conversation(uuid, text, text, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.my_conversations(uuid) to authenticated;
grant execute on function public.can_read_announcement(uuid) to authenticated;
grant execute on function public.can_read_announcement_row(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.can_read_folder_row(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.can_read_folder(uuid) to authenticated;
grant execute on function public.can_write_folder(uuid) to authenticated;
grant execute on function public.can_read_file(uuid) to authenticated;
grant execute on function public.org_slug(uuid) to authenticated;
grant execute on function public.display_name_of(uuid) to authenticated;
revoke execute on function public.my_team_ids(uuid), public.user_membership_id(uuid, uuid),
  public.can_read_conversation(uuid), public.can_manage_conversation(uuid),
  public.start_direct_conversation(uuid, uuid),
  public.create_conversation(uuid, text, text, text, text, uuid, uuid[]),
  public.mark_conversation_read(uuid), public.my_conversations(uuid), public.can_read_announcement(uuid),
  public.can_read_folder(uuid), public.can_write_folder(uuid), public.can_read_file(uuid),
  public.org_slug(uuid), public.display_name_of(uuid), public.my_user_id(),
  public.can_read_announcement_row(uuid, text, uuid, uuid), public.can_read_folder_row(uuid, text, uuid, uuid)
  from anon, public;

-- Realtime: deliver new messages and notifications to subscribed clients (RLS applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications;
  end if;
end $$;

-- Audit: announcements and document lifecycle.
create trigger audit_announcements after insert or update or delete on public.announcements
  for each row execute function public.audit_row_change('id', 'body');
create trigger audit_folders after insert or update or delete on public.folders
  for each row execute function public.audit_row_change();
create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function public.audit_row_change('id', 'description');

-- Default folders and the company channel for every organization (existing and new).
create or replace function public.seed_organization_collaboration(p_org uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('wbh.trusted_op', 'on', true);
  if not exists (select 1 from public.folders where organization_id = p_org and parent_id is null and scope = 'organization' and name = 'Company') then
    insert into public.folders (organization_id, name, scope) values (p_org, 'Company', 'organization');
  end if;
  if not exists (select 1 from public.folders where organization_id = p_org and scope = 'hr') then
    insert into public.folders (organization_id, name, scope) values (p_org, 'HR (confidential)', 'hr');
  end if;
  if not exists (select 1 from public.conversations where organization_id = p_org and type = 'channel' and audience = 'organization') then
    insert into public.conversations (organization_id, type, name, topic, audience)
    values (p_org, 'channel', 'general', 'Company-wide conversation', 'organization');
  end if;
  perform set_config('wbh.trusted_op', 'off', true);
end;
$$;

revoke all on function public.seed_organization_collaboration(uuid) from public, anon, authenticated;

create or replace function public.seed_collaboration_on_org()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.seed_organization_collaboration(new.id);
  return null;
end;
$$;

create trigger organizations_seed_collaboration after insert on public.organizations
  for each row execute function public.seed_collaboration_on_org();

select public.seed_organization_collaboration(id) from public.organizations;
