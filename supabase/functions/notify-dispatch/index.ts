/**
 * Outbox worker for booking reminders, woken by Supabase Cron (pg_cron +
 * pg_net, see migration 0500) with a shared secret.
 *
 * Jobs are claimed with a lease (SKIP LOCKED), re-checked against the
 * booking (still confirmed, same start time, live studio) and only then sent
 * via Web Push. Gone endpoints (404/410) are deleted; transient failures are
 * retried with exponential backoff.
 */
import {createClient} from '@supabase/supabase-js';
import webpush from 'web-push';
import {fail, json} from '../_shared/http.ts';
import {when} from '../_shared/text.ts';

const env = (k: string) => Deno.env.get(k);
const svc = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});

type Job = {
  id: number;
  booking_start_at: string;
  booking: {id: string; status: string; start_at: string; service_name: string; is_demo: boolean};
  tenant: {slug: string; name: string; status: string; timezone: string; address: string};
  subscriptions: {endpoint: string; p256dh: string; auth: string}[];
};

Deno.serve(async req => {
  const secret = req.headers.get('x-cron-secret') ?? '';
  const ok = await svc.rpc('svc_check_cron_secret', {p_secret: secret});
  if (!ok.data) return fail(req, 401, 'UNAUTHORIZED', 'bad secret');

  const pub = env('VAPID_PUBLIC_KEY');
  const priv = env('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return fail(req, 503, 'NOT_CONFIGURED', 'VAPID keys are not set');
  webpush.setVapidDetails(env('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);

  const worker = crypto.randomUUID();
  const claimed = await svc.rpc('svc_claim_notification_jobs', {p_worker: worker, p_limit: 25, p_lease_seconds: 120});
  if (claimed.error) return fail(req, 500, 'CLAIM_FAILED', claimed.error.message);
  const jobs = (claimed.data ?? []) as Job[];
  const results: {id: number; outcome: string}[] = [];

  for (const job of jobs) {
    const b = job.booking;
    const done = (outcome: string, error?: string, gone: string[] = []) =>
      svc.rpc('svc_complete_notification_job', {p_job_id: job.id, p_worker: worker, p_outcome: outcome, p_error: error ?? null, p_gone_endpoints: gone});

    // Re-check right before sending: a moved or cancelled booking must not be reminded.
    if (b.status !== 'confirmed' || new Date(b.start_at).getTime() !== new Date(job.booking_start_at).getTime()) {
      await done('cancelled', 'booking changed');
      results.push({id: job.id, outcome: 'cancelled'});
      continue;
    }
    if (job.tenant.status !== 'live' || b.is_demo) {
      await done('cancelled', 'preview: notifications disabled');
      results.push({id: job.id, outcome: 'cancelled'});
      continue;
    }
    if (!job.subscriptions.length) {
      await done('failed', 'no subscriptions');
      results.push({id: job.id, outcome: 'failed'});
      continue;
    }

    const payload = JSON.stringify({
      title: job.tenant.name,
      body: `${b.service_name} — ${when(b.start_at, job.tenant.timezone)}. ${job.tenant.address}`,
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
    await done(outcome, errors.join('; ') || (gone.length ? 'subscription gone' : undefined), gone);
    results.push({id: job.id, outcome});
  }

  return json(req, {worker, processed: results.length, results});
});
