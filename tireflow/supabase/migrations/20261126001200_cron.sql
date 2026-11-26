-- TireFlow · central scheduler (one set of jobs for all tenants, never per tenant)
-- Requires two Vault secrets in each environment (see DEPLOYMENT.md):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service role / secret key>', 'worker_key');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Notification queue: every minute, small idempotent batches.
select cron.schedule('tireflow-notifications-worker', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notifications-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'worker_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
  where exists (select 1 from public.notification_jobs where status = 'queued' and run_at <= now())
    and exists (select 1 from vault.decrypted_secrets where name = 'project_url');
$$);

-- Storage-ending reminders + cleanup of expired idempotency keys and rate-limit windows.
select cron.schedule('tireflow-periodic', '7 * * * *', $$ select public.schedule_periodic_notifications(); $$);

-- Expire waiting-list entries whose window has passed.
select cron.schedule('tireflow-waitlist-expire', '15 3 * * *', $$
  update public.waiting_list set status = 'expired' where status in ('waiting', 'offered') and latest < current_date;
$$);
