-- Hosted Supabase grants EXECUTE on new functions to anon/authenticated by default.
-- Trigger functions cannot be invoked directly, but revoke anyway for hygiene.
revoke all on function public.touch_conversation() from public, anon, authenticated;
revoke all on function public.notify_on_message() from public, anon, authenticated;
revoke all on function public.notify_on_announcement() from public, anon, authenticated;
revoke all on function public.seed_collaboration_on_org() from public, anon, authenticated;
revoke all on function public.notify_task_assignment() from public, anon, authenticated;
revoke all on function public.check_daily_hours() from public, anon, authenticated;
revoke all on function public.seed_workforce_on_org() from public, anon, authenticated;
