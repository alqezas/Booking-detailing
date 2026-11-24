/**
 * Outbox worker for booking notifications, woken by Supabase Cron (pg_cron +
 * pg_net, see migration 0500) with a shared secret — and right after a client
 * books, moves or cancels (migration beauty: enqueue_telegram).
 *
 * Jobs are claimed with a lease (SKIP LOCKED) and re-checked before sending:
 *   reminder_24h  Web Push (VAPID) to the customer: booking still confirmed,
 *                 same start time, live studio. Gone endpoints are deleted.
 *   tg_*          Telegram message to the owner's chat (TELEGRAM_BOT_TOKEN),
 *                 live studio and real (non-demo) booking only.
 * Transient failures are retried with exponential backoff; a missing secret
 * fails the job with a readable reason that the cabinet shows.
 */
import {createClient} from '@supabase/supabase-js';
import webpush from 'web-push';
import {fail, json} from '../_shared/http.ts';
import {langOf} from '../_shared/lang.ts';
import {telegramOutcome, telegramText, type TgJob} from '../_shared/telegram.ts';
import {when} from '../_shared/text.ts';

const env = (k: string) => Deno.env.get(k);
const svc = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});

type Job = {
  id: number;
  kind: 'reminder_24h' | 'tg_new' | 'tg_cancel' | 'tg_moved';
  booking_start_at: string;
  booking: TgJob['booking'] & {status: string; is_demo: boolean};
  tenant: TgJob['tenant'] & {status: string; address: string; locale?: string; telegram_chat_id?: string | null};
  subscriptions: {endpoint: string; p256dh: string; auth: string}[];
};

Deno.serve(async req => {
  const secret = req.headers.get('x-cron-secret') ?? '';
  const ok = await svc.rpc('svc_check_cron_secret', {p_secret: secret});
  if (!ok.data) return fail(req, 401, 'UNAUTHORIZED', 'bad secret');

  const pub = env('VAPID_PUBLIC_KEY');
  const priv = env('VAPID_PRIVATE_KEY');
  const pushReady = !!pub && !!priv;
  if (pushReady) webpush.setVapidDetails(env('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub!, priv!);
  const botToken = env('TELEGRAM_BOT_TOKEN');
  const siteUrl = env('SITE_URL') ?? null;

  const worker = crypto.randomUUID();
  const claimed = await svc.rpc('svc_claim_notification_jobs', {p_worker: worker, p_limit: 25, p_lease_seconds: 120});
  if (claimed.error) return fail(req, 500, 'CLAIM_FAILED', claimed.error.message);
  const jobs = (claimed.data ?? []) as Job[];
  const results: {id: number; kind: string; outcome: string}[] = [];

  for (const job of jobs) {
    const b = job.booking;
    const done = (outcome: string, error?: string, gone: string[] = []) =>
      svc.rpc('svc_complete_notification_job', {p_job_id: job.id, p_worker: worker, p_outcome: outcome, p_error: error ?? null, p_gone_endpoints: gone});
    const finish = async (outcome: string, error?: string, gone?: string[]) => {
      await done(outcome, error, gone);
      results.push({id: job.id, kind: job.kind, outcome});
    };

    if (job.tenant.status !== 'live' || b.is_demo) {
      await finish('cancelled', 'preview: notifications disabled');
      continue;
    }

    // ---- Telegram to the owner -------------------------------------------
    if (job.kind !== 'reminder_24h') {
      if (!botToken) {
        await finish('failed', 'TELEGRAM_BOT_TOKEN is not set on the server');
        continue;
      }
      if (!job.tenant.telegram_chat_id) {
        await finish('cancelled', 'telegram chat id removed');
        continue;
      }
      const text = telegramText(job as unknown as TgJob, langOf(job.tenant.locale), siteUrl);
      let status = 0;
      let detail = '';
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({chat_id: job.tenant.telegram_chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true}),
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
        if (!res.ok) detail = ((await res.json().catch(() => null)) as {description?: string} | null)?.description ?? `HTTP ${res.status}`;
      } catch (e) {
        detail = `network: ${(e as Error).message}`.slice(0, 200);
      }
      const outcome = telegramOutcome(status);
      await finish(outcome, outcome === 'sent' ? undefined : `telegram ${status || 'net'}: ${detail}`.slice(0, 300));
      continue;
    }

    // ---- Web Push reminder to the customer --------------------------------
    // Re-check right before sending: a moved or cancelled booking must not be reminded.
    if (b.status !== 'confirmed' || new Date(b.start_at).getTime() !== new Date(job.booking_start_at).getTime()) {
      await finish('cancelled', 'booking changed');
      continue;
    }
    if (!pushReady) {
      await finish('retry', 'VAPID keys are not set on the server');
      continue;
    }
    if (!job.subscriptions.length) {
      await finish('failed', 'no subscriptions');
      continue;
    }
    const payload = JSON.stringify({
      title: job.tenant.name,
      body: `${b.service_name} — ${when(b.start_at, job.tenant.timezone, undefined, langOf(job.tenant.locale))}. ${job.tenant.address}`,
      url: `/s/${job.tenant.slug}/my?b=${b.id}`,
      tag: `reminder-${b.id}`,
    });
    let sent = 0;
    const gone: string[] = [];
    const errors: string[] = [];
    for (const s of job.subscriptions) {
      try {
        await webpush.sendNotification({endpoint: s.endpoint, keys: {p256dh: s.p256dh, auth: s.auth}}, payload, {TTL: 6 * 3600, urgency: 'normal'});
        sent++;
      } catch (e) {
        const status = (e as {statusCode?: number}).statusCode ?? 0;
        if (status === 404 || status === 410) gone.push(s.endpoint);
        else errors.push(`${status || 'net'}: ${(e as Error).message}`.slice(0, 160));
      }
    }
    const outcome = sent > 0 ? 'sent' : gone.length === job.subscriptions.length ? 'failed' : 'retry';
    await finish(outcome, errors.join('; ') || (gone.length ? 'subscription gone' : undefined), gone);
  }

  return json(req, {worker, processed: results.length, results});
});
