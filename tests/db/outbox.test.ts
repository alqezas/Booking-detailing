import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {admin, anonRpc, at, bookingArgs, closeDb, createTestTenant, db, localDate, ownerClient, type TestTenant} from './helpers.ts';

const SUB = {
  p_endpoint: 'https://push.example.test/send/abc123',
  p_p256dh: 'BOr8Gq6k0wXxQyq0x2p5P1dCqWj0e0vZ0n6r4Xb1bW5vQ4bW1mYJbqv8cT0Fv3c2n6Q1',
  p_auth: 'k8JV6sjdbhAi-n3Qw1x2Yw',
};

let live: TestTenant;

beforeAll(async () => {
  live = await createTestTenant();
  const {error} = await admin().rpc('svc_activate_tenant', {p_slug: live.slug});
  if (error) throw error;
});
afterAll(closeDb);

const jobs = async (bookingId: string) =>
  (await db().query('select id::int as id, status, run_at, booking_start_at, dedupe_key from notification_jobs where booking_id = $1 order by id', [bookingId])).rows;

/** Leave only this test's jobs claimable. */
const parkOtherJobs = (keepBooking: string) =>
  db().query(`update notification_jobs set run_at = now() + interval '30 days' where booking_id <> $1 and status = 'pending'`, [keepBooking]);

describe('reminder outbox', () => {
  it('subscribing creates exactly one reminder 24h before the start', async () => {
    const start = at(live.timezone, localDate(live.timezone, 5), '10:00');
    const r = await anonRpc('public_create_booking', bookingArgs(live, 'wash', start));
    const token = r.data.access_token;
    const s1 = await anonRpc('public_save_push_subscription', {p_slug: live.slug, p_token: token, ...SUB});
    expect(s1.status).toBe(200);
    expect(s1.data.reminder.status).toBe('pending');
    await anonRpc('public_save_push_subscription', {p_slug: live.slug, p_token: token, ...SUB}); // dedup
    const list = await jobs(r.data.booking.id);
    expect(list).toHaveLength(1);
    expect(list[0].run_at.toISOString()).toBe(new Date(new Date(start).getTime() - 86400e3).toISOString());
  });

  it('reschedule voids the old reminder and plans a new one; cancel voids it', async () => {
    const {client} = await ownerClient(live.slug);
    const d = localDate(live.timezone, 6);
    const r = await anonRpc('public_create_booking', bookingArgs(live, 'wash', at(live.timezone, d, '10:00')));
    await anonRpc('public_save_push_subscription', {p_slug: live.slug, p_token: r.data.access_token, ...SUB});
    const moved = await client.rpc('owner_reschedule_booking', {p_booking_id: r.data.booking.id, p_start_at: at(live.timezone, d, '15:00')});
    expect(moved.error).toBeNull();
    let list = await jobs(r.data.booking.id);
    expect(list.map(j => j.status)).toEqual(['cancelled', 'pending']);
    expect(list[1].booking_start_at.toISOString()).toBe(at(live.timezone, d, '15:00'));
    await client.rpc('owner_cancel_booking', {p_booking_id: r.data.booking.id});
    list = await jobs(r.data.booking.id);
    expect(list.map(j => j.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('claims with a lease, one worker at a time; expired leases are reclaimed', async () => {
    const r = await anonRpc('public_create_booking', bookingArgs(live, 'wash', at(live.timezone, localDate(live.timezone, 7), '10:00')));
    await anonRpc('public_save_push_subscription', {p_slug: live.slug, p_token: r.data.access_token, ...SUB});
    const [job] = await jobs(r.data.booking.id);
    await parkOtherJobs(r.data.booking.id);
    await db().query(`update notification_jobs set run_at = now() - interval '1 minute' where id = $1`, [job.id]);

    const sb = admin();
    const [c1, c2] = await Promise.all([
      sb.rpc('svc_claim_notification_jobs', {p_worker: 'w1', p_limit: 10, p_lease_seconds: 60}),
      sb.rpc('svc_claim_notification_jobs', {p_worker: 'w2', p_limit: 10, p_lease_seconds: 60}),
    ]);
    const claimed = [...(c1.data as any[]), ...(c2.data as any[])].filter(j => j.id === job.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].subscriptions).toHaveLength(1);
    const winner = (c1.data as any[]).some(j => j.id === job.id) ? 'w1' : 'w2';
    const loser = winner === 'w1' ? 'w2' : 'w1';

    // The other worker cannot complete a job it does not hold
    expect((await sb.rpc('svc_complete_notification_job', {p_job_id: job.id, p_worker: loser, p_outcome: 'sent'})).data).toBe(false);

    // Simulate a crash: lease expires, a third worker takes over
    await db().query(`update notification_jobs set lease_until = now() - interval '1 second' where id = $1`, [job.id]);
    const c3 = await sb.rpc('svc_claim_notification_jobs', {p_worker: 'w3', p_limit: 10, p_lease_seconds: 60});
    expect((c3.data as any[]).map(j => j.id)).toContain(job.id);
    expect((await sb.rpc('svc_complete_notification_job', {p_job_id: job.id, p_worker: winner, p_outcome: 'sent'})).data).toBe(false);
    expect((await sb.rpc('svc_complete_notification_job', {p_job_id: job.id, p_worker: 'w3', p_outcome: 'sent'})).data).toBe(true);
    const [done] = await jobs(r.data.booking.id);
    expect(done.status).toBe('sent');
  });

  it('retries with backoff, gives up after max attempts and drops gone endpoints', async () => {
    const r = await anonRpc('public_create_booking', bookingArgs(live, 'wash', at(live.timezone, localDate(live.timezone, 8), '10:00')));
    await anonRpc('public_save_push_subscription', {p_slug: live.slug, p_token: r.data.access_token, ...SUB});
    const [job] = await jobs(r.data.booking.id);
    await parkOtherJobs(r.data.booking.id);
    const sb = admin();
    await db().query(`update notification_jobs set run_at = now() - interval '1 minute', max_attempts = 2 where id = $1`, [job.id]);
    await sb.rpc('svc_claim_notification_jobs', {p_worker: 'w', p_limit: 10});
    await sb.rpc('svc_complete_notification_job', {p_job_id: job.id, p_worker: 'w', p_outcome: 'retry', p_error: '503'});
    let [j] = await jobs(r.data.booking.id);
    expect(j.status).toBe('pending');
    expect(j.run_at.getTime()).toBeGreaterThan(Date.now());
    await db().query(`update notification_jobs set run_at = now() - interval '1 minute' where id = $1`, [job.id]);
    await sb.rpc('svc_claim_notification_jobs', {p_worker: 'w', p_limit: 10});
    await sb.rpc('svc_complete_notification_job', {
      p_job_id: job.id, p_worker: 'w', p_outcome: 'retry', p_error: '410', p_gone_endpoints: [SUB.p_endpoint],
    });
    [j] = await jobs(r.data.booking.id);
    expect(j.status).toBe('failed');
    const {rows} = await db().query('select count(*)::int n from push_subscriptions where booking_id = $1', [r.data.booking.id]);
    expect(rows[0].n).toBe(0);
  });

  it('a preview studio never queues a real notification', async () => {
    const preview = await createTestTenant();
    const r = await anonRpc('public_create_booking', bookingArgs(preview, 'wash', at(preview.timezone, localDate(preview.timezone, 5), '10:00')));
    const s = await anonRpc('public_save_push_subscription', {p_slug: preview.slug, p_token: r.data.access_token, ...SUB});
    expect(s.data.reminder.status).toBe('skipped');
    expect(s.data.is_demo).toBe(true);
  });
});

describe('preview → live', () => {
  it('activation purges demo data and keeps the catalogue', async () => {
    const p = await createTestTenant();
    await anonRpc('public_create_booking', bookingArgs(p, 'wash', at(p.timezone, localDate(p.timezone, 3), '10:00')));
    const {data} = await admin().rpc('svc_activate_tenant', {p_slug: p.slug});
    expect(data.demo_bookings_removed).toBe(1);
    const after = await anonRpc('public_create_booking', bookingArgs(p, 'wash', at(p.timezone, localDate(p.timezone, 3), '10:00')));
    expect(after.data.booking.is_demo).toBe(false);
  });

  it('re-publishing keeps bookings, payments and owner photos', async () => {
    const p = await createTestTenant();
    const {client} = await ownerClient(p.slug);
    const r = await anonRpc('public_create_booking', bookingArgs(p, 'polish', at(p.timezone, localDate(p.timezone, 3), '10:00')));
    await client.from('gallery_items').insert({tenant_id: p.id, image_path: `${p.id}/own.webp`, caption: 'Моё фото'});
    // Re-publish with the polish service removed from the config
    const {rows} = await db().query('select config_hash from tenants where id = $1', [p.id]);
    expect(rows[0].config_hash).toBe('test');
    const cfg = (await db().query(`select public.public_get_tenant($1) as t`, [p.slug])).rows[0].t;
    const {error} = await admin().rpc('svc_sync_tenant', {
      p_config: {
        slug: p.slug, name: 'Renamed', kind: 'detailing', timezone: 'Europe/Moscow', accentColor: '#112233',
        contacts: {phone: '+79990000000', address: 'Test street 1'}, images: {hero: '/h.webp', logo: '/l.png'},
        hours: {mon: [['09:00', '21:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: []},
        closedDates: [], booking: {slotStepMinutes: 30, minLeadMinutes: 0, horizonDays: 30, cancelCutoffHours: 12, defaultBufferMinutes: 30},
        resources: [{key: 'bay-1', name: 'Bay 1'}],
        services: [{key: 'wash', name: 'Wash', price: 3000, durationMinutes: 60, resources: ['bay-1']}],
        infoCards: cfg.info_cards, gallery: [],
      },
      p_config_hash: 'v2',
      p_sync_content: true,
    });
    expect(error).toBeNull();
    const booking = await client.rpc('owner_booking', {p_booking_id: r.data.booking.id});
    expect(booking.data.service_name).toBe('Polish');
    expect(booking.data.status).toBe('confirmed');
    const {data: svc} = await client.from('services').select('key, is_active').eq('key', 'polish');
    expect(svc?.[0]?.is_active).toBe(false); // deactivated, not deleted
    const {data: gallery} = await client.from('gallery_items').select('caption, source');
    expect(gallery).toEqual([{caption: 'Моё фото', source: 'owner'}]);
  });
});
