/**
 * Telegram outbox end-to-end on the local stack (`pnpm functions:serve`):
 * a live beauty studio with a chat id gets a client booking → the dispatcher
 * claims the tg_new job and calls the Bot API.
 *
 *   npx tsx tests/integration/telegram-check.ts
 *
 * Without TELEGRAM_BOT_TOKEN in supabase/functions/.env the job must end as
 * «failed: TELEGRAM_BOT_TOKEN is not set» — honestly, never «sent». With a real
 * token and TELEGRAM_TEST_CHAT_ID in the environment of this script, the
 * message is really delivered to that chat and the job ends «sent».
 */
import {execSync} from 'node:child_process';

const out = execSync('npx supabase status -o env', {encoding: 'utf8'});
for (const line of out.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[`SB_${m[1]}`] = m[2];
}
const {admin, anonRpc, at, createTestTenant, db, key, localDate, closeDb} = await import('../db/helpers.ts');

const chat = process.env.TELEGRAM_TEST_CHAT_ID ?? '123456789';
const t = await createTestTenant({
  kind: 'beauty',
  timezone: 'Europe/Prague',
  currency: 'CZK',
  resources: [{key: 'anna', name: 'Anna', role: 'master'}],
  services: [{key: 'mani', name: 'Manicure', price: 750, durationMinutes: 60, resources: ['anna'], addons: [{key: 'removal', name: 'Removal', price: 100, minutes: 15}]}],
  notifications: {telegramChatId: chat},
} as never);
await admin().rpc('svc_activate_tenant', {p_slug: t.slug});
const r = await anonRpc('public_create_beauty_booking', {
  p_slug: t.slug,
  p_service_id: t.services.mani,
  p_start_at: at(t.timezone, localDate(t.timezone, 3), '10:00'),
  p_resource_id: null,
  p_customer_name: 'Telegram Check',
  p_customer_phone: '+420777000999',
  p_comment: 'local check',
  p_idempotency_key: key(),
  p_addons: ['removal'],
});
if (r.error) throw new Error(JSON.stringify(r.error));
const bookingId = r.data.booking.id;
// Only this job is due now.
await db().query(`update notification_jobs set run_at = now() + interval '30 days' where status = 'pending' and booking_id <> $1`, [bookingId]);
const secret = (await db().query(`select value from private.app_secrets where name = 'cron_secret'`)).rows[0].value;
const res = await fetch(`${process.env.SB_API_URL}/functions/v1/notify-dispatch`, {method: 'POST', headers: {'x-cron-secret': secret, 'content-type': 'application/json'}, body: '{}'});
console.log('dispatch', res.status, await res.text());
const {rows} = await db().query(`select kind, status, attempts, last_error, sent_at from notification_jobs where booking_id = $1 and kind like 'tg\\_%'`, [bookingId]);
console.log(rows);
const job = rows[0];
const ok = process.env.TELEGRAM_TEST_CHAT_ID ? job?.status === 'sent' : job?.status === 'failed' && /TELEGRAM_BOT_TOKEN/.test(job.last_error ?? '');
console.log(ok ? '✓ outbox state is honest' : '✗ unexpected outbox state');
await db().query(`update notification_jobs set run_at = now() where run_at > now() + interval '29 days' and status = 'pending'`);
await closeDb();
process.exit(ok ? 0 : 1);
