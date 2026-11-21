-- Invites and updates: attachments (tickets, itineraries, documents) and the sender's signature.
alter table public.calendar_broadcasts
  add column if not exists attachments jsonb not null default '[]',
  add column if not exists signature text check (signature is null or char_length(signature) <= 2000);

-- Each sender's saved email signature, added to what they send.
create table if not exists public.email_signatures (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  signature text not null check (char_length(signature) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.email_signatures enable row level security;
grant select, insert, update on public.email_signatures to authenticated;
create policy email_signatures_own_select on public.email_signatures for select to authenticated using (user_id = auth.uid());
create policy email_signatures_own_insert on public.email_signatures for insert to authenticated with check (user_id = auth.uid());
create policy email_signatures_own_update on public.email_signatures for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
