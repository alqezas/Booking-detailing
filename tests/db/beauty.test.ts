/**
 * Beauty engine on the real local Supabase (PostgREST as the browser calls it):
 * add-ons sum up on the server, buffers, two masters and «any free master»,
 * master shifts / days off / blocks, concurrency, idempotency, customer
 * reschedule, historical prices, payments and statistics, RLS of the new
 * tables, the Telegram outbox and the owner's free-window count.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {admin, anonRpc, at, closeDb, createTestTenant, db, key, localDate, ownerClient, type TestTenant} from './helpers.ts';

const WEEK = (from: string, to: string) => ({mon: [[from, to]], tue: [[from, to]], wed: [[from, to]], thu: [[from, to]], fri: [[from, to]], sat: [[from, to]], sun: [[from, to]]});

async function beautyTenant(extra: Record<string, unknown> = {}): Promise<TestTenant> {
  return createTestTenant({
    kind: 'beauty',
    timezone: 'Europe/Prague',
    currency: 'CZK',
    hours: WEEK('09:00', '20:00') as never,
    booking: {slotStepMinutes: 15, minLeadMinutes: 0, horizonDays: 30, cancelCutoffHours: 6, defaultBufferMinutes: 15},
    resources: [
      {key: 'anna', name: 'Anna', role: 'master', title: 'Nails'},
      {key: 'vika', name: 'Vika', role: 'master', title: 'Brows', hours: WEEK('12:00', '20:00') as never},
    ],
    services: [
      {
        key: 'mani',
        name: 'Manicure gel',
        price: 750,
        durationMinutes: 90,
        resources: ['anna', 'vika'],
        addons: [
          {key: 'removal', name: 'Removal of old coating', price: 100, minutes: 15},
          {key: 'repair', name: 'Nail repair', price: 100, minutes: 10},
          {key: 'strong', name: 'Strengthening', price: 150, minutes: 15},
        ],
      },
      {key: 'brows', name: 'Brows', price: 600, durationMinutes: 45, bufferMinutes: 10, resources: ['vika']},
      {key: 'spa', name: 'Hand spa', price: 350, durationMinutes: 30, bufferMinutes: 0, resources: ['anna']},
    ],
    infoCards: [
      {icon: 'shield', title: 'Sterile', text: 'Dry heat'},
      {icon: 'map-pin', title: 'Where', text: 'Metro'},
      {icon: 'calendar', title: 'Moving', text: '6 hours'},
    ],
    ...extra,
  });
}

const phone = () => `+42077${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const book = (t: TestTenant, service: string, startAt: string, extra: Record<string, unknown> = {}) =>
  anonRpc('public_create_beauty_booking', {
    p_slug: t.slug,
    p_service_id: t.services[service],
    p_start_at: startAt,
    p_resource_id: null,
    p_customer_name: 'Test Client',
    p_customer_phone: phone(),
    p_comment: '',
    p_idempotency_key: key(),
    p_addons: [],
    ...extra,
  });
const slotsOf = async (t: TestTenant, service: string, day: string, extra: Record<string, unknown> = {}) => {
  const r = await anonRpc('public_get_beauty_availability', {p_slug: t.slug, p_service_id: t.services[service], p_addons: [], p_resource_id: null, p_from: day, p_days: 1, ...extra});
  if (r.error) throw new Error(JSON.stringify(r.error));
  return {quote: r.data.quote, slots: (r.data.days[0]?.slots ?? []) as {start_at: string; available: boolean}[]};
};
const iso = (s: string) => new Date(s).toISOString();

let t: TestTenant;
let day: string;
beforeAll(async () => {
  t = await beautyTenant();
  day = localDate(t.timezone, 4);
});
afterAll(closeDb);

describe('add-ons and buffer', () => {
  it('the server sums duration and price of the chosen options; the client sends neither', async () => {
    const start = at(t.timezone, day, '09:00');
    const r = await book(t, 'mani', start, {p_addons: ['strong', 'removal']});
    expect(r.error).toBeNull();
    const b = r.data.booking;
    expect(b.price).toBe(750 + 100 + 150);
    expect(b.duration_minutes).toBe(90 + 15 + 15);
    expect(iso(b.end_at)).toBe(iso(at(t.timezone, day, '11:00')));
    expect(b.tire_params.kind).toBe('addons');
    expect(b.tire_params.addons.map((a: {key: string}) => a.key)).toEqual(['removal', 'strong']);
    // Occupancy = service + 15 min default buffer (sterilisation).
    const {rows} = await db().query('select upper(period) as until from resource_occupancies where booking_id = $1', [b.id]);
    expect(iso(rows[0].until)).toBe(iso(at(t.timezone, day, '11:15')));
  });

  it('quote of the availability call equals the booking price', async () => {
    const {quote} = await slotsOf(t, 'mani', day, {p_addons: ['repair']});
    expect(quote.price).toBe(850);
    expect(quote.duration_minutes).toBe(100);
  });

  it('rejects an option the service does not offer', async () => {
    const r = await book(t, 'mani', at(t.timezone, day, '15:00'), {p_addons: ['gold-leaf']});
    expect(r.status).toBe(422);
    expect(r.error.message).toBe('ADDON_NOT_FOUND');
  });

  it('the buffer keeps the master busy after the service (per-service buffer too)', async () => {
    const d = localDate(t.timezone, 5);
    const first = await book(t, 'brows', at(t.timezone, d, '13:00')); // 45 min + 10 buffer → 13:55
    expect(first.error).toBeNull();
    const {slots} = await slotsOf(t, 'brows', d);
    const free = (hhmm: string) => slots.find(s => iso(s.start_at) === iso(at(t.timezone, d, hhmm)))?.available;
    expect(free('13:45')).toBe(false);
    expect(free('14:00')).toBe(true);
  });
});

describe('two masters', () => {
  it('«any free master»: two bookings of one slot go to different masters, the third is refused', async () => {
    const d = localDate(t.timezone, 6);
    const start = at(t.timezone, d, '14:00');
    const [a, b] = await Promise.all([book(t, 'mani', start), book(t, 'mani', start)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(new Set([a.data.booking.resource_name, b.data.booking.resource_name])).toEqual(new Set(['Anna', 'Vika']));
    expect(a.data.booking.tire_params.master_choice).toBe('any');
    const c = await book(t, 'mani', start);
    expect(c.status).toBe(409);
    expect(c.error.message).toBe('SLOT_TAKEN');
  });

  it('a chosen master: only that master is tried, even when the other one is free', async () => {
    const d = localDate(t.timezone, 7);
    const start = at(t.timezone, d, '15:00');
    const a = await book(t, 'mani', start, {p_resource_id: t.resources.anna});
    expect(a.data.booking.resource_name).toBe('Anna');
    expect(a.data.booking.tire_params.master_choice).toBe('specific');
    const again = await book(t, 'mani', start, {p_resource_id: t.resources.anna});
    expect(again.error.message).toBe('SLOT_TAKEN');
    const viaVika = await book(t, 'mani', start, {p_resource_id: t.resources.vika});
    expect(viaVika.data.booking.resource_name).toBe('Vika');
  });

  it('concurrency: 10 simultaneous requests for one master and time → exactly one booking', async () => {
    const d = localDate(t.timezone, 8);
    const start = at(t.timezone, d, '16:00');
    const results = await Promise.all(Array.from({length: 10}, () => book(t, 'spa', start)));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409).every(r => r.error.message === 'SLOT_TAKEN')).toBe(true);
  });

  it('a master the service does not use is rejected', async () => {
    const r = await book(t, 'brows', at(t.timezone, localDate(t.timezone, 8), '13:00'), {p_resource_id: t.resources.anna});
    expect(r.status).toBe(422);
    expect(r.error.message).toBe('RESOURCE_NOT_SUITABLE');
  });
});

describe('shifts, days off and blocks', () => {
  it('the own shift narrows the studio hours: Vika (12–20) cannot start brows at 10:00', async () => {
    const d = localDate(t.timezone, 9);
    const {slots} = await slotsOf(t, 'brows', d);
    const at10 = slots.find(s => iso(s.start_at) === iso(at(t.timezone, d, '10:00')));
    const at12 = slots.find(s => iso(s.start_at) === iso(at(t.timezone, d, '12:00')));
    expect(at10?.available).toBe(false);
    expect(at12?.available).toBe(true);
    const r = await book(t, 'brows', at(t.timezone, d, '10:00'));
    expect(r.error.message).toBe('SLOT_TAKEN'); // a studio slot, but no master works then
    // Manicure at 10:00 with «any» goes to Anna, who follows the studio hours.
    const m = await book(t, 'mani', at(t.timezone, d, '10:00'));
    expect(m.data.booking.resource_name).toBe('Anna');
    // The service must end inside the shift: 19:30 + 45 > 20:00.
    const late = slots.find(s => iso(s.start_at) === iso(at(t.timezone, d, '19:30')));
    expect(late?.available ?? false).toBe(false);
  });

  it('a master day off removes that master only', async () => {
    const d = localDate(t.timezone, 10);
    await db().query(`insert into resource_exceptions (tenant_id, resource_id, day, is_closed) values ($1, $2, $3, true)`, [t.id, t.resources.vika, d]);
    const brows = await slotsOf(t, 'brows', d);
    expect(brows.slots.every(s => !s.available)).toBe(true);
    const mani = await slotsOf(t, 'mani', d, {p_resource_id: t.resources.anna});
    expect(mani.slots.some(s => s.available)).toBe(true);
  });

  it('a manual block by the master uses the same occupancy table and stops bookings', async () => {
    const {client} = await ownerClient(t.slug);
    const d = localDate(t.timezone, 11);
    const blk = await client.rpc('owner_block_resource', {
      p_tenant_id: t.id,
      p_resource_id: t.resources.anna,
      p_from: at(t.timezone, d, '09:00'),
      p_to: at(t.timezone, d, '20:00'),
      p_note: 'training',
    });
    expect(blk.error).toBeNull();
    const r = await book(t, 'spa', at(t.timezone, d, '11:00'));
    expect(r.error.message).toBe('SLOT_TAKEN');
    const {rows} = await db().query(`select kind from resource_occupancies where id = $1`, [blk.data]);
    expect(rows[0].kind).toBe('block');
  });
});

describe('idempotency and history', () => {
  it('a retry returns the same booking and the same token; another option set with that key is refused', async () => {
    const k = key();
    const p = phone();
    const args = {p_customer_phone: p, p_idempotency_key: k, p_addons: ['repair']};
    const start = at(t.timezone, localDate(t.timezone, 12), '09:00');
    const a = await book(t, 'mani', start, args);
    const b = await book(t, 'mani', start, args);
    expect(b.data.booking.id).toBe(a.data.booking.id);
    expect(b.data.access_token).toBe(a.data.access_token);
    expect(b.data.replayed).toBe(true);
    const other = await book(t, 'mani', start, {...args, p_addons: ['removal']});
    expect(other.status).toBe(409);
    expect(other.error.message).toBe('IDEMPOTENCY_MISMATCH');
    const {rows} = await db().query('select count(*)::int as n from bookings where tenant_id = $1 and idempotency_key = $2', [t.id, k]);
    expect(rows[0].n).toBe(1);
  });

  it('later price edits never change an agreed booking', async () => {
    const r = await book(t, 'mani', at(t.timezone, localDate(t.timezone, 12), '14:00'), {p_addons: ['strong']});
    await db().query(`update service_addons set price = 999 where tenant_id = $1 and key = 'strong'`, [t.id]);
    await db().query(`update services set price = 2000 where id = $1`, [t.services.mani]);
    const {rows} = await db().query('select price, tire_params from bookings where id = $1', [r.data.booking.id]);
    expect(rows[0].price).toBe(900);
    expect(rows[0].tire_params.addons[0].price).toBe(150);
    await db().query(`update service_addons set price = 150 where tenant_id = $1 and key = 'strong'`, [t.id]);
    await db().query(`update services set price = 750 where id = $1`, [t.services.mani]);
  });
});

describe('customer reschedule', () => {
  it('moves atomically by token; a taken time leaves the booking where it was', async () => {
    const d = localDate(t.timezone, 13);
    const mine = await book(t, 'spa', at(t.timezone, d, '09:00'));
    const other = await book(t, 'spa', at(t.timezone, d, '12:00'));
    expect(other.error).toBeNull();
    const token = mine.data.access_token;
    const fail = await anonRpc('public_reschedule_booking', {p_slug: t.slug, p_token: token, p_start_at: at(t.timezone, d, '12:00')});
    expect(fail.status).toBe(409);
    expect(fail.error.message).toBe('SLOT_TAKEN');
    const still = await anonRpc('public_get_booking', {p_slug: t.slug, p_token: token});
    expect(iso(still.data.start_at)).toBe(iso(at(t.timezone, d, '09:00')));
    const ok = await anonRpc('public_reschedule_booking', {p_slug: t.slug, p_token: token, p_start_at: at(t.timezone, d, '15:00')});
    expect(ok.error).toBeNull();
    expect(iso(ok.data.start_at)).toBe(iso(at(t.timezone, d, '15:00')));
    const {rows} = await db().query('select lower(period) as s from resource_occupancies where booking_id = $1', [mine.data.booking.id]);
    expect(iso(rows[0].s)).toBe(iso(at(t.timezone, d, '15:00')));
    // The same request again is a no-op.
    const again = await anonRpc('public_reschedule_booking', {p_slug: t.slug, p_token: token, p_start_at: at(t.timezone, d, '15:00')});
    expect(again.error).toBeNull();
  });

  it('a chosen master stays the same when the client moves the booking', async () => {
    const d = localDate(t.timezone, 14);
    const mine = await book(t, 'mani', at(t.timezone, d, '13:00'), {p_resource_id: t.resources.vika});
    // Vika is busy at 16:00, Anna is free: the move must not switch masters.
    await book(t, 'mani', at(t.timezone, d, '16:00'), {p_resource_id: t.resources.vika});
    const r = await anonRpc('public_reschedule_booking', {p_slug: t.slug, p_token: mine.data.access_token, p_start_at: at(t.timezone, d, '16:00')});
    expect(r.error.message).toBe('SLOT_TAKEN');
  });

  it('move options: own slot is not busy; the booking duration with options and its buffer count', async () => {
    const d = localDate(t.timezone, 17);
    // Anna alone before 12:00 (Vika starts at 12). Spa 09:00–09:30 and 12:15–12:45, no buffer.
    await book(t, 'spa', at(t.timezone, d, '09:00'));
    await book(t, 'spa', at(t.timezone, d, '12:15'));
    // Manicure + removal = 105 min + 15 buffer: occupies 10:00–12:00.
    const mine = await book(t, 'mani', at(t.timezone, d, '10:00'), {p_resource_id: t.resources.anna, p_addons: ['removal']});
    expect(mine.error).toBeNull();
    const free = (r: {data: {days: {slots: {start_at: string; available: boolean}[]}[]}}, hhmm: string) =>
      r.data.days[0]!.slots.find(s => iso(s.start_at) === iso(at(t.timezone, d, hhmm)))?.available;

    const client = await anonRpc('public_reschedule_options', {p_slug: t.slug, p_token: mine.data.access_token, p_from: d, p_days: 1});
    expect(client.error).toBeNull();
    expect(free(client, '09:30')).toBe(true); // overlaps only its own current time
    expect(free(client, '10:15')).toBe(true); // 10:15 + 120 = 12:15
    expect(free(client, '10:30')).toBe(false); // with options it would run into the 12:15 spa

    const {client: owner} = await ownerClient(t.slug);
    const o = await owner.rpc('owner_move_options', {p_booking_id: mine.data.booking.id, p_from: d, p_days: 1});
    expect(o.error).toBeNull();
    expect(free(o as never, '09:30')).toBe(true);
    expect(free(o as never, '10:30')).toBe(false);

    // What the picker offers, the move accepts.
    const moved = await owner.rpc('owner_reschedule_booking', {p_booking_id: mine.data.booking.id, p_start_at: at(t.timezone, d, '09:30')});
    expect(moved.error).toBeNull();

    // Another studio's owner cannot read the options.
    const stranger = await ownerClient((await beautyTenant()).slug);
    const denied = await stranger.client.rpc('owner_move_options', {p_booking_id: mine.data.booking.id, p_from: d, p_days: 1});
    expect(denied.error).not.toBeNull();
  });

  it('inside the deadline the move is refused', async () => {
    const soon = new Date(Date.now() + 3 * 3600e3);
    soon.setUTCMinutes(0, 0, 0);
    const {rows} = await db().query(
      `insert into bookings (tenant_id, service_id, resource_id, start_at, end_at, occupancy_end_at, service_name, price, duration_minutes, buffer_minutes,
         customer_name, customer_phone, car, source, idempotency_key, request_fingerprint)
       values ($1, $2, $3, $4, $4::timestamptz + interval '30 min', $4::timestamptz + interval '30 min', 'Hand spa', 350, 30, 0, 'Late', '+420777000111', '', 'owner', $5, 'x')
       returning id`,
      [t.id, t.services.spa, t.resources.anna, soon.toISOString(), key()],
    );
    const tokenRow = await db().query(`select private.booking_token($1, 'k') as tok`, [rows[0].id]);
    await db().query(`insert into booking_access (booking_id, tenant_id, token_hash) values ($1, $2, private.token_hash($3))`, [rows[0].id, t.id, tokenRow.rows[0].tok]);
    const r = await anonRpc('public_reschedule_booking', {p_slug: t.slug, p_token: tokenRow.rows[0].tok, p_start_at: at(t.timezone, localDate(t.timezone, 15), '10:00')});
    expect(r.status).toBe(409);
    expect(r.error.message).toBe('RESCHEDULE_TOO_LATE');
  });
});

describe('payments and statistics', () => {
  it('separates upcoming, completed, no-shows and money received; filters by master', async () => {
    const s = await beautyTenant();
    const {client} = await ownerClient(s.slug);
    const today = localDate(s.timezone, 0);
    const mk = async (hhmm: string, master: string, d = today) =>
      (
        await client.rpc('owner_create_beauty_booking', {
          p_tenant_id: s.id,
          p_service_id: s.services.mani,
          p_start_at: at(s.timezone, d, hhmm),
          p_resource_id: s.resources[master],
          p_customer_name: 'Client',
          p_customer_phone: phone(),
          p_comment: '',
          p_addons: ['removal'],
          p_idempotency_key: key(),
          p_respect_schedule: false,
        })
      ).data;
    const done = await mk('06:00', 'anna');
    const missed = await mk('03:00', 'vika');
    const future = await mk('12:00', 'vika', localDate(s.timezone, 2));
    expect(done.price).toBe(850);
    expect((await client.rpc('owner_set_booking_status', {p_booking_id: done.id, p_status: 'ready'})).error).toBeNull();
    expect((await client.rpc('owner_set_booking_status', {p_booking_id: missed.id, p_status: 'no_show'})).error).toBeNull();
    const pay = await client.rpc('owner_add_payment', {p_booking_id: done.id, p_kind: 'payment', p_amount: 850, p_method: 'card', p_note: '', p_idempotency_key: key()});
    expect(pay.error).toBeNull();
    const refund = await client.rpc('owner_add_payment', {p_booking_id: done.id, p_kind: 'refund', p_amount: 100, p_method: 'cash', p_note: '', p_idempotency_key: key()});
    expect(refund.error).toBeNull();

    const week = (await client.rpc('owner_stats_for', {p_tenant_id: s.id, p_period: 'month', p_anchor: today, p_resource_id: null})).data;
    expect(week.completed).toBe(1);
    expect(week.no_show).toBe(1);
    expect(week.received).toBe(850);
    expect(week.net_received).toBe(750);
    expect(week.upcoming).toBeGreaterThanOrEqual(future.start_at.slice(0, 7) === today.slice(0, 7) ? 1 : 0);
    const anna = (await client.rpc('owner_stats_for', {p_tenant_id: s.id, p_period: 'day', p_anchor: today, p_resource_id: s.resources.anna})).data;
    expect(anna.completed).toBe(1);
    expect(anna.no_show).toBe(0);
    expect(anna.net_received).toBe(750);
    const vika = (await client.rpc('owner_stats_for', {p_tenant_id: s.id, p_period: 'day', p_anchor: today, p_resource_id: s.resources.vika})).data;
    expect(vika.no_show).toBe(1);
    expect(vika.received).toBe(0);
  });

  it('counts free windows of a period for the owner assistant', async () => {
    const {client} = await ownerClient(t.slug);
    const r = await client.rpc('owner_free_slot_summary', {p_tenant_id: t.id, p_period: 'week', p_anchor: localDate(t.timezone, 7), p_resource_id: null});
    expect(r.error).toBeNull();
    const mani = r.data.services.find((x: {service_id: string}) => x.service_id === t.services.mani);
    expect(mani.free_starts).toBeGreaterThan(0);
    expect(mani.first_free).toBeTruthy();
  });
});

describe('access control of the new tables', () => {
  it('anon reads none of them; another owner sees nothing of this studio; the chat id is not public', async () => {
    const {env} = await import('./helpers.ts');
    for (const table of ['service_addons', 'resource_hours', 'resource_exceptions']) {
      const res = await fetch(`${env().url}/rest/v1/${table}?select=*`, {headers: {apikey: env().anon}});
      expect([401, 403]).toContain(res.status);
    }
    await db().query(`update tenants set telegram_chat_id = '123456789' where id = $1`, [t.id]);
    const card = await anonRpc('public_get_tenant', {p_slug: t.slug});
    expect(JSON.stringify(card.data)).not.toContain('123456789');
    expect(card.data.services.find((s: {key: string}) => s.key === 'mani').addons).toHaveLength(3);

    const other = await beautyTenant();
    const {client} = await ownerClient(other.slug);
    expect((await client.from('service_addons').select('id').eq('tenant_id', t.id)).data).toEqual([]);
    expect((await client.from('resource_hours').select('id').eq('tenant_id', t.id)).data).toEqual([]);
    expect((await client.from('tenants').select('telegram_chat_id').eq('id', t.id)).data).toEqual([]);
    const forged = await client.from('service_addons').insert({tenant_id: t.id, service_id: t.services.mani, key: 'evil', name: 'Evil', price: 0, duration_minutes: 0});
    expect(forged.error).not.toBeNull();
    // Linking an own add-on to a foreign service fails on the composite FK.
    const cross = await client.from('service_addons').insert({tenant_id: other.id, service_id: t.services.mani, key: 'cross', name: 'Cross', price: 0, duration_minutes: 0});
    expect(cross.error).not.toBeNull();
    for (const [fn, args] of [
      ['owner_set_telegram', {p_tenant_id: t.id, p_chat_id: '987654321'}],
      ['owner_set_resource_hours', {p_tenant_id: t.id, p_resource_id: t.resources.anna, p_custom: true, p_hours: []}],
      ['owner_notification_status', {p_tenant_id: t.id}],
      ['owner_stats_for', {p_tenant_id: t.id, p_period: 'day', p_anchor: localDate(t.timezone, 0), p_resource_id: null}],
    ] as const) {
      const r = await client.rpc(fn, args);
      expect(r.error?.message, fn).toBe('forbidden');
    }
    await db().query(`update tenants set telegram_chat_id = null where id = $1`, [t.id]);
  });
});

describe('telegram outbox', () => {
  const tgJobs = async (bookingId: string) =>
    (await db().query(`select kind, status, last_error, dedupe_key from notification_jobs where booking_id = $1 and kind like 'tg\\_%' order by id`, [bookingId])).rows;

  it('a preview studio queues nothing deliverable: the job is «skipped» with the reason', async () => {
    const p = await beautyTenant({notifications: {telegramChatId: '111111111'}});
    const r = await book(p, 'spa', at(p.timezone, localDate(p.timezone, 3), '10:00'));
    const list = await tgJobs(r.data.booking.id);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('skipped');
    expect(list[0].last_error).toMatch(/preview/);
  });

  it('live: new, moved and cancelled by the client each make one job; owner actions make none', async () => {
    const live = await beautyTenant({notifications: {telegramChatId: '-1001234567890'}});
    expect((await admin().rpc('svc_activate_tenant', {p_slug: live.slug})).error).toBeNull();
    const d = localDate(live.timezone, 4);
    const r = await book(live, 'spa', at(live.timezone, d, '10:00'));
    const token = r.data.access_token;
    const id = r.data.booking.id;
    expect((await tgJobs(id)).map(j => [j.kind, j.status])).toEqual([['tg_new', 'pending']]);
    await anonRpc('public_reschedule_booking', {p_slug: live.slug, p_token: token, p_start_at: at(live.timezone, d, '11:00')});
    await anonRpc('public_reschedule_booking', {p_slug: live.slug, p_token: token, p_start_at: at(live.timezone, d, '11:00')}); // no-op
    await anonRpc('public_cancel_booking', {p_slug: live.slug, p_token: token});
    await anonRpc('public_cancel_booking', {p_slug: live.slug, p_token: token}); // idempotent
    expect((await tgJobs(id)).map(j => j.kind)).toEqual(['tg_new', 'tg_moved', 'tg_cancel']);

    const {client} = await ownerClient(live.slug);
    const own = await client.rpc('owner_create_beauty_booking', {
      p_tenant_id: live.id,
      p_service_id: live.services.spa,
      p_start_at: at(live.timezone, d, '14:00'),
      p_resource_id: null,
      p_customer_name: 'Phone client',
      p_customer_phone: phone(),
      p_comment: '',
      p_addons: [],
      p_idempotency_key: key(),
    });
    expect(own.error).toBeNull();
    await client.rpc('owner_cancel_booking', {p_booking_id: own.data.id, p_reason: 'test'});
    expect(await tgJobs(own.data.id)).toEqual([]);

    // The claim hands the dispatcher the chat id and the message data (service role only).
    await db().query(`update notification_jobs set run_at = now() + interval '30 days' where status = 'pending' and booking_id <> $1`, [id]);
    const claim = await admin().rpc('svc_claim_notification_jobs', {p_worker: 'test-worker', p_limit: 10, p_lease_seconds: 60});
    const mine = (claim.data as {kind: string; booking: {id: string; customer_phone: string}; tenant: {telegram_chat_id: string}}[]).filter(j => j.booking.id === id);
    expect(mine.map(j => j.kind).sort()).toEqual(['tg_cancel', 'tg_moved', 'tg_new']);
    expect(mine[0]!.tenant.telegram_chat_id).toBe('-1001234567890');
    expect(mine[0]!.booking.customer_phone).toMatch(/^\+420/);
    // A cancel or move does not void the owner's notice (reminder logic is separate).
    for (const j of claim.data as {id: number}[]) {
      await admin().rpc('svc_complete_notification_job', {p_job_id: j.id, p_worker: 'test-worker', p_outcome: 'sent'});
    }
  });

  it('without a chat id nothing is queued', async () => {
    const r = await book(t, 'spa', at(t.timezone, localDate(t.timezone, 16), '10:00'));
    expect(await tgJobs(r.data.booking.id)).toEqual([]);
  });
});

describe('demo seed of a beauty preview', () => {
  it('creates flagged demo bookings with options, no car, inside master shifts', async () => {
    const p = await beautyTenant();
    const n = (await admin().rpc('svc_seed_demo_bookings', {p_slug: p.slug})).data as number;
    expect(n).toBeGreaterThan(5);
    const {rows} = await db().query(
      `select b.is_demo, b.car, b.source, b.tire_params->>'kind' as kind, r.key as master, b.start_at
       from bookings b join resources r on r.id = b.resource_id where b.tenant_id = $1`,
      [p.id],
    );
    expect(rows.every(r => r.is_demo && r.car === '' && r.source === 'demo' && r.kind === 'addons')).toBe(true);
    // Vika works from 12:00: no demo booking of hers starts at 11:00.
    expect(rows.filter(r => r.master === 'vika').every(r => new Intl.DateTimeFormat('en-GB', {timeZone: p.timezone, hour: '2-digit'}).format(r.start_at) !== '11')).toBe(true);
  });
});
