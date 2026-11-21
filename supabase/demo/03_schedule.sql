-- Run demo.refresh() every hour (demo project only).
create extension if not exists pg_cron;
select cron.schedule('demo-refresh', '7 * * * *', $$select demo.refresh()$$);
