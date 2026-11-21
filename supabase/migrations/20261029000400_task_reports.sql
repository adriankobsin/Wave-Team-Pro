-- Task reports: the person doing a task reports back "completed" or "not completed" with notes,
-- and whoever set the task hears about it (and about new notes and photos).

alter table public.tasks
  add column if not exists outcome text check (outcome in ('completed', 'not_completed')),
  add column if not exists outcome_note text check (outcome_note is null or char_length(outcome_note) <= 4000),
  add column if not exists outcome_by uuid references public.profiles (id),
  add column if not exists outcome_at timestamptz;

-- Everyone who should hear about a task, except the person acting: its creator, the project
-- manager, and the people assigned.
create or replace function public.notify_task_people(p_task uuid, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_user uuid;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null then
    return;
  end if;
  for v_user in
    select t.created_by
    union select m.user_id from public.projects p join public.organization_memberships m on m.id = p.manager_membership_id where p.id = t.project_id
    union select a.user_id from public.task_assignees a where a.task_id = t.id
  loop
    perform public.notify(t.organization_id, v_user, 'task', p_title, p_body, '/o/' || public.org_slug(t.organization_id) || '/tasks/' || t.id);
  end loop;
end;
$$;

revoke all on function public.notify_task_people(uuid, text, text) from public, anon, authenticated;

-- "Completed" / "Not completed" with the reasoning. Anyone working on the task may report.
create or replace function public.report_task(p_task uuid, p_outcome text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who text;
begin
  if p_outcome not in ('completed', 'not_completed') then
    raise exception 'Choose completed or not completed' using errcode = '22023';
  end if;
  if p_outcome = 'not_completed' and v_note is null then
    raise exception 'Say why it isn''t completed' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 4000 then
    raise exception 'Keep the note under 4000 characters' using errcode = '22023';
  end if;
  select * into t from public.tasks where id = p_task;
  if t.id is null or not public.can_work_on_task(p_task) then
    raise exception 'You can''t report on this task' using errcode = '42501';
  end if;

  perform set_config('wbh.trusted_op', 'on', true);
  update public.tasks
    set outcome = p_outcome, outcome_note = v_note, outcome_by = auth.uid(), outcome_at = now(),
        status = case when p_outcome = 'completed' then 'done' else 'review' end,
        completed_at = case when p_outcome = 'completed' then now() else null end
    where id = p_task;
  insert into public.task_comments (task_id, organization_id, author_id, body)
  values (p_task, t.organization_id, auth.uid(),
    case when p_outcome = 'completed' then 'Marked completed' else 'Marked NOT completed' end || coalesce(': ' || v_note, '.'));
  perform set_config('wbh.trusted_op', 'off', true);

  v_who := coalesce(public.display_name_of(auth.uid()), 'Someone');
  perform public.notify_task_people(p_task,
    v_who || case when p_outcome = 'completed' then ' completed: ' else ' could not complete: ' end || t.title,
    v_note);
end;
$$;

revoke all on function public.report_task(uuid, text, text) from public, anon;
grant execute on function public.report_task(uuid, text, text) to authenticated;

-- New notes on a task reach the others involved (report_task notifies on its own).
create or replace function public.notify_task_comment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
begin
  if new.body like 'Marked completed%' or new.body like 'Marked NOT completed%' then
    return null;
  end if;
  select title into v_title from public.tasks where id = new.task_id;
  perform public.notify_task_people(new.task_id,
    coalesce(public.display_name_of(new.author_id), 'Someone') || ' added a note: ' || coalesce(v_title, 'task'),
    new.body);
  return null;
end;
$$;

revoke all on function public.notify_task_comment() from public, anon, authenticated;

create or replace trigger task_comments_notify after insert on public.task_comments
  for each row execute function public.notify_task_comment();
