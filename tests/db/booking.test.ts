import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
  admin,
  anonRpc,
  at,
  bookingArgs,
  closeDb,
  createTestTenant,
  db,
  key,
  localDate,
  ownerClient,
  type TestTenant,
} from './helpers.ts';

let t: TestTenant;
let day: string;

beforeAll(async () => {
  t = await createTestTenant();
  day = localDate(t.timezone, 3);
});
afterAll(closeDb);

describe('availability', () => {
  it('generates slots from working hours in the studio time zone', async () => {
    const {data, error} = await anonRpc('public_get_availability', {
      p_slug: t.slug, p_service_id: t.services.wash, p_from: day, p_days: 1,
    });
    expect(error).toBeNull();
    const slots = data.days[0].slots;
    // 09:00..20:00 every 30 minutes for a 60-minute service that must end by 21:00
    expect(slots).toHaveLength(23);
    expect(slots[0].start_at).toBe(at(t.timezone, day, '09:00').replace('.000Z', '+00:00'));
    expect(slots.every((s: any) => s.available)).toBe(true);
  });

  it('rejects a start that is not a slot', async () => {
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, day, '09:10')));
    expect(r.status).toBe(422);
    expect(r.error.message).toBe('NOT_A_SLOT');
    const late = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, day, '20:30')));
    expect(late.error.message).toBe('NOT_A_SLOT'); // would finish after closing
  });
});

describe('concurrency', () => {
  it('lets exactly one of many simultaneous requests take a single-bay slot', async () => {
    const start = at(t.timezone, day, '10:00');
    const results = await Promise.all(
      Array.from({length: 12}, () => anonRpc('public_create_booking', bookingArgs(t, 'wash', start))),
    );
    const ok = results.filter(r => r.status === 200);
    const taken = results.filter(r => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(taken).toHaveLength(11);
    expect(taken.every(r => r.error.message === 'SLOT_TAKEN')).toBe(true);
    const {rows} = await db().query(
      `select count(*)::int as n from resource_occupancies where tenant_id = $1 and period && tstzrange($2::timestamptz, $2::timestamptz + interval '1 hour')`,
      [t.id, start],
    );
    expect(rows[0].n).toBe(1);
  });

  it('fills both suitable bays and then reports the slot as taken', async () => {
    const start = at(t.timezone, day, '14:00');
    const results = await Promise.all(
      Array.from({length: 6}, () => anonRpc('public_create_booking', bookingArgs(t, 'polish', start))),
    );
    const ok = results.filter(r => r.status === 200);
    expect(ok).toHaveLength(2);
    const bays = new Set(ok.map(r => r.data.booking.resource_name));
    expect(bays).toEqual(new Set(['Bay 1', 'Bay 2']));
    const {data} = await anonRpc('public_get_availability', {p_slug: t.slug, p_service_id: t.services.polish, p_from: day, p_days: 1});
    const slot = data.days[0].slots.find((s: any) => new Date(s.start_at).toISOString() === start);
    expect(slot.available).toBe(false);
  });
});

describe('multi-day occupancy', () => {
  it('a two-day service blocks its bay across days and nights', async () => {
    const d = localDate(t.timezone, 6);
    const next = localDate(t.timezone, 7);
    const start = at(t.timezone, d, '10:00');
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'ceramic', start));
    expect(r.status).toBe(200);
    // 1980 min + 60 buffer = 34 h → bay-1 busy until 20:00 the next day
    expect(new Date(r.data.booking.end_at).toISOString()).toBe(at(t.timezone, next, '19:00'));
    const {data} = await anonRpc('public_get_availability', {p_slug: t.slug, p_service_id: t.services.wash, p_from: next, p_days: 1});
    const slots = data.days[0].slots;
    const free = slots.filter((s: any) => s.available).map((s: any) => new Date(s.start_at).toISOString());
    expect(free).toEqual([at(t.timezone, next, '20:00')]);
    const blocked = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, next, '18:00')));
    expect(blocked.error.message).toBe('SLOT_TAKEN');
  });
});

describe('idempotency', () => {
  it('returns the same booking and the same access token on retry', async () => {
    const args = bookingArgs(t, 'polish', at(t.timezone, day, '17:00'));
    const first = await anonRpc('public_create_booking', args);
    const second = await anonRpc('public_create_booking', args);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.data.booking.id).toBe(first.data.booking.id);
    expect(second.data.access_token).toBe(first.data.access_token);
    expect(second.data.replayed).toBe(true);
    const {rows} = await db().query('select count(*)::int n from bookings where tenant_id = $1 and idempotency_key = $2', [t.id, args.p_idempotency_key]);
    expect(rows[0].n).toBe(1);
  });

  it('collapses concurrent double submits into one booking', async () => {
    const args = bookingArgs(t, 'polish', at(t.timezone, day, '18:00'));
    const results = await Promise.all(Array.from({length: 5}, () => anonRpc('public_create_booking', args)));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(new Set(results.map(r => r.data.booking.id)).size).toBe(1);
  });

  it('refuses to reuse a key for a different request', async () => {
    const args = bookingArgs(t, 'polish', at(t.timezone, day, '09:00'));
    expect((await anonRpc('public_create_booking', args)).status).toBe(200);
    const other = await anonRpc('public_create_booking', {...args, p_start_at: at(t.timezone, day, '09:30')});
    expect(other.status).toBe(409);
    expect(other.error.message).toBe('IDEMPOTENCY_MISMATCH');
  });
});

describe('customer access by token', () => {
  it('stores only a hash and opens the booking with the token', async () => {
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, day, '11:00')));
    const token = r.data.access_token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const {rows} = await db().query('select token_hash from booking_access where booking_id = $1', [r.data.booking.id]);
    expect(Buffer.from(rows[0].token_hash).toString('utf8')).not.toContain(token);
    const got = await anonRpc('public_get_booking', {p_slug: t.slug, p_token: token});
    expect(got.data.id).toBe(r.data.booking.id);
    const wrongSlug = await anonRpc('public_get_booking', {p_slug: 'graphite', p_token: token});
    expect(wrongSlug.status).toBe(404);
    const forged = await anonRpc('public_get_booking', {p_slug: t.slug, p_token: token.slice(0, -2) + 'xx'});
    expect(forged.status).toBe(404);
  });

  it('cancels within the rules, frees the slot and is idempotent', async () => {
    const start = at(t.timezone, day, '20:00');
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'wash', start));
    const token = r.data.access_token;
    const c1 = await anonRpc('public_cancel_booking', {p_slug: t.slug, p_token: token});
    expect(c1.data.status).toBe('cancelled');
    const c2 = await anonRpc('public_cancel_booking', {p_slug: t.slug, p_token: token});
    expect(c2.data.status).toBe('cancelled');
    const again = await anonRpc('public_create_booking', bookingArgs(t, 'wash', start));
    expect(again.status).toBe(200);
  });

  it('refuses online cancellation after the cutoff', async () => {
    const soon = await createTestTenant({booking: {slotStepMinutes: 30, minLeadMinutes: 0, horizonDays: 30, cancelCutoffHours: 336, defaultBufferMinutes: 0}});
    const r = await anonRpc('public_create_booking', bookingArgs(soon, 'wash', at(soon.timezone, localDate(soon.timezone, 3), '10:00')));
    expect(r.data.booking.can_cancel).toBe(false);
    const c = await anonRpc('public_cancel_booking', {p_slug: soon.slug, p_token: r.data.access_token});
    expect(c.status).toBe(409);
    expect(c.error.message).toBe('CANCEL_TOO_LATE');
  });
});

describe('owner operations', () => {
  it('blocks a bay through the same occupancy table', async () => {
    const {client} = await ownerClient(t.slug);
    const d = localDate(t.timezone, 9);
    const {data: blockId, error} = await client.rpc('owner_block_resource', {
      p_tenant_id: t.id, p_resource_id: t.resources['bay-1'], p_from: at(t.timezone, d, '09:00'), p_to: at(t.timezone, d, '13:00'), p_note: 'Ремонт',
    });
    expect(error).toBeNull();
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, d, '11:00')));
    expect(r.error.message).toBe('SLOT_TAKEN');
    // A block cannot overlap an existing booking either
    const ok = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, d, '15:00')));
    expect(ok.status).toBe(200);
    const clash = await client.rpc('owner_block_resource', {
      p_tenant_id: t.id, p_resource_id: t.resources['bay-1'], p_from: at(t.timezone, d, '14:00'), p_to: at(t.timezone, d, '16:00'),
    });
    expect(clash.error?.message).toBe('SLOT_TAKEN');
    await client.rpc('owner_remove_block', {p_occupancy_id: blockId});
    const after = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, d, '11:00')));
    expect(after.status).toBe(200);
  });

  it('reschedules atomically and keeps the original when the target is taken', async () => {
    const {client} = await ownerClient(t.slug);
    const d = localDate(t.timezone, 10);
    const a = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, d, '10:00')));
    const b = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, d, '12:00')));
    const moved = await client.rpc('owner_reschedule_booking', {p_booking_id: a.data.booking.id, p_start_at: at(t.timezone, d, '15:00')});
    expect(moved.error).toBeNull();
    expect(new Date(moved.data.start_at).toISOString()).toBe(at(t.timezone, d, '15:00'));
    const fail = await client.rpc('owner_reschedule_booking', {p_booking_id: b.data.booking.id, p_start_at: at(t.timezone, d, '15:00')});
    expect(fail.error?.message).toBe('SLOT_TAKEN');
    const {rows} = await db().query(
      `select b.start_at, o.period from bookings b join resource_occupancies o on o.booking_id = b.id where b.id = $1`,
      [b.data.booking.id],
    );
    expect(rows[0].start_at.toISOString()).toBe(at(t.timezone, d, '12:00'));
    // The freed 10:00 slot is bookable again
    const again = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, d, '10:00')));
    expect(again.status).toBe(200);
  });

  it('keeps the agreed price when the service price changes later', async () => {
    const {client} = await ownerClient(t.slug);
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, localDate(t.timezone, 11), '10:00')));
    expect(r.data.booking.price).toBe(3000);
    const upd = await client.from('services').update({price: 5500}).eq('id', t.services.wash).select('price');
    expect(upd.error).toBeNull();
    expect(upd.data?.[0]?.price).toBe(5500);
    const {data} = await client.rpc('owner_booking', {p_booking_id: r.data.booking.id});
    expect(data.price).toBe(3000);
    await admin().from('services').update({price: 3000}).eq('id', t.services.wash);
  });

  it('records payments and refunds; stats separate visits, completed work and money', async () => {
    const own = await createTestTenant();
    const {client} = await ownerClient(own.slug);
    const today = localDate(own.timezone, 0);
    // Owner books today at a past slot (owner may book outside the public window)
    const created = await client.rpc('owner_create_booking', {
      p_tenant_id: own.id, p_service_id: own.services.polish, p_start_at: at(own.timezone, today, '09:00'),
      p_customer_name: 'Иван', p_customer_phone: '+79991112233', p_car: 'BMW X5', p_idempotency_key: key(),
      p_respect_schedule: false,
    });
    expect(created.error).toBeNull();
    const id = created.data.id;
    const future = await client.rpc('owner_create_booking', {
      p_tenant_id: own.id, p_service_id: own.services.wash, p_start_at: at(own.timezone, localDate(own.timezone, 1), '10:00'),
      p_customer_name: 'Пётр', p_customer_phone: '+79991112244', p_car: 'Lada', p_idempotency_key: key(),
    });
    expect(future.error).toBeNull();

    expect((await client.rpc('owner_set_booking_status', {p_booking_id: id, p_status: 'arrived'})).error).toBeNull();
    expect((await client.rpc('owner_set_booking_status', {p_booking_id: id, p_status: 'ready'})).error).toBeNull();
    const payKey = key();
    const p1 = await client.rpc('owner_add_payment', {p_booking_id: id, p_kind: 'payment', p_amount: 10000, p_method: 'card', p_idempotency_key: payKey});
    expect(p1.data.paid).toBe(10000);
    const replay = await client.rpc('owner_add_payment', {p_booking_id: id, p_kind: 'payment', p_amount: 10000, p_method: 'card', p_idempotency_key: payKey});
    expect(replay.data.paid).toBe(10000);
    const tooMuch = await client.rpc('owner_add_payment', {p_booking_id: id, p_kind: 'refund', p_amount: 20000, p_idempotency_key: key()});
    expect(tooMuch.error?.message).toBe('REFUND_TOO_LARGE');
    const refund = await client.rpc('owner_add_payment', {p_booking_id: id, p_kind: 'refund', p_amount: 1500, p_idempotency_key: key()});
    expect(refund.data.refunded).toBe(1500);
    expect(refund.data.balance).toBe(1500);

    const {data: day} = await client.rpc('owner_stats', {p_tenant_id: own.id, p_period: 'day'});
    expect(day).toMatchObject({arrivals: 1, completed: 1, received: 10000, refunded: 1500, net_received: 8500, bookings: 1});
    const {data: week} = await client.rpc('owner_stats', {p_tenant_id: own.id, p_period: 'week'});
    // The future booking is a forecast, not money received
    expect(week.received).toBe(10000);
    expect(week.expected_value).toBeGreaterThanOrEqual(10000);
  });

  it('reports a clear error for an illegal status change', async () => {
    const {client} = await ownerClient(t.slug);
    const r = await anonRpc('public_create_booking', bookingArgs(t, 'wash', at(t.timezone, localDate(t.timezone, 12), '10:00')));
    await client.rpc('owner_cancel_booking', {p_booking_id: r.data.booking.id, p_reason: 'test'});
    const bad = await client.rpc('owner_set_booking_status', {p_booking_id: r.data.booking.id, p_status: 'ready'});
    expect(bad.error?.message).toBe('INVALID_TRANSITION');
  });
});

describe('time zones and dates', () => {
  it('honours days off and the studio time zone', async () => {
    const ekb = await createTestTenant({timezone: 'Asia/Yekaterinburg', closedDates: [localDate('Asia/Yekaterinburg', 4)]});
    const d = localDate(ekb.timezone, 3);
    const {data} = await anonRpc('public_get_availability', {p_slug: ekb.slug, p_service_id: ekb.services.wash, p_from: d, p_days: 2});
    expect(data.days).toHaveLength(1); // the closed day has no slots at all
    expect(new Date(data.days[0].slots[0].start_at).toISOString()).toBe(at('Asia/Yekaterinburg', d, '09:00'));
    expect(at('Asia/Yekaterinburg', d, '09:00')).toMatch(/T04:00:00/);
  });

  it('keeps local wall-clock slots across a DST change', async () => {
    const berlin = await createTestTenant({timezone: 'Europe/Berlin'});
    const {rows} = await db().query(
      `select start_at from private.slot_candidates($1, 60, '2026-10-25', '2026-10-26') order by 1`,
      [berlin.id],
    );
    const iso = rows.map(r => r.start_at.toISOString());
    expect(iso[0]).toBe('2026-10-25T08:00:00.000Z'); // 09:00 CET after the switch
    expect(iso).toContain('2026-10-26T08:00:00.000Z');
  });
});
