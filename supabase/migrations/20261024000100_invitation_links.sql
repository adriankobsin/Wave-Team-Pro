-- Invitation links owned by the app: a random token (only its SHA-256 is stored) that stays
-- valid as long as the invitation is pending. Opening the link does nothing until the person
-- presses the button, so email security scanners can't use it up. Only the server (service
-- role) reads or writes this table.
create table public.invitation_links (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index invitation_links_invitation_idx on public.invitation_links (invitation_id);

alter table public.invitation_links enable row level security;
revoke all on public.invitation_links from public, anon, authenticated;
