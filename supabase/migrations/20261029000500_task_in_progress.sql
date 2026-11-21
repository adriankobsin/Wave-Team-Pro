-- Report back now also accepts "in progress" (with an optional note): the task shows as In progress
-- and whoever set it is told. The outcome column stays for the final word (completed / not completed).
create or replace function public.report_task(p_task uuid, p_outcome text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who text;
begin
  if p_outcome not in ('completed', 'not_completed', 'in_progress') then
    raise exception 'Choose completed, in progress or not completed' using errcode = '22023';
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
    set outcome = case when p_outcome = 'in_progress' then null else p_outcome end,
        outcome_note = v_note, outcome_by = auth.uid(), outcome_at = now(),
        status = case p_outcome when 'completed' then 'done' when 'in_progress' then 'in_progress' else 'review' end,
        completed_at = case when p_outcome = 'completed' then now() else null end
    where id = p_task;
  insert into public.task_comments (task_id, organization_id, author_id, body)
  values (p_task, t.organization_id, auth.uid(),
    case p_outcome when 'completed' then 'Marked completed' when 'in_progress' then 'Marked in progress' else 'Marked NOT completed' end
    || coalesce(': ' || v_note, '.'));
  perform set_config('wbh.trusted_op', 'off', true);

  v_who := coalesce(public.display_name_of(auth.uid()), 'Someone');
  perform public.notify_task_people(p_task,
    v_who || case p_outcome when 'completed' then ' completed: ' when 'in_progress' then ' is working on: ' else ' could not complete: ' end || t.title,
    v_note);
end;
$$;

revoke all on function public.report_task(uuid, text, text) from public, anon;
grant execute on function public.report_task(uuid, text, text) to authenticated;

create or replace function public.notify_task_comment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
begin
  if new.body like 'Marked completed%' or new.body like 'Marked NOT completed%' or new.body like 'Marked in progress%' then
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
