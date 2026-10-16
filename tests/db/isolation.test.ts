import {createClient} from '@supabase/supabase-js';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {admin, anonRpc, at, bookingArgs, closeDb, createTestTenant, env, key, localDate, ownerClient, type TestTenant} from './helpers.ts';

let a: TestTenant;
let b: TestTenant;
let ownerA: Awaited<ReturnType<typeof ownerClient>>;
let bookingB: string;

beforeAll(async () => {
  a = await createTestTenant();
  b = await createTestTenant();
  ownerA = await ownerClient(a.slug);
  const r = await anonRpc('public_create_booking', bookingArgs(b, 'wash', at(b.timezone, localDate(b.timezone, 2), '10:00')));
  bookingB = r.data.booking.id;
  await anonRpc('public_create_booking', bookingArgs(a, 'wash', at(a.timezone, localDate(a.timezone, 2), '10:00')));
});
afterAll(closeDb);

describe('tenant isolation (RLS on the server)', () => {
  it('an owner sees only their own studio, bookings and payments', async () => {
    const c = ownerA.client;
    const tenants = await c.from('tenants').select('id');
    expect(tenants.data?.map(t => t.id)).toEqual([a.id]);
    const bookings = await c.from('bookings').select('id, tenant_id');
    expect(bookings.data?.length).toBeGreaterThan(0);
    expect(bookings.data?.every(x => x.tenant_id === a.id)).toBe(true);
    const direct = await c.from('bookings').select('id').eq('id', bookingB);
    expect(direct.data).toEqual([]);
    const pays = await c.from('payments').select('id').eq('tenant_id', b.id);
    expect(pays.data).toEqual([]);
  });

  it('owner functions refuse another studio', async () => {
    const c = ownerA.client;
    for (const [fn, args] of [
      ['owner_stats', {p_tenant_id: b.id, p_period: 'week'}],
      ['owner_bookings', {p_tenant_id: b.id, p_from: new Date().toISOString(), p_to: new Date(Date.now() + 86400e3).toISOString()}],
      ['owner_booking', {p_booking_id: bookingB}],
      ['owner_cancel_booking', {p_booking_id: bookingB}],
      ['owner_set_booking_status', {p_booking_id: bookingB, p_status: 'arrived'}],
      ['owner_add_payment', {p_booking_id: bookingB, p_kind: 'payment', p_amount: 100, p_idempotency_key: key()}],
      ['owner_update_tenant', {p_tenant_id: b.id, p_patch: {name: 'Hijacked'}}],
      ['owner_block_resource', {p_tenant_id: b.id, p_resource_id: b.resources['bay-1'], p_from: new Date().toISOString(), p_to: new Date(Date.now() + 3600e3).toISOString()}],
    ] as const) {
      const {error} = await c.rpc(fn, args as never);
      expect(error?.message, fn).toMatch(/forbidden|BOOKING_NOT_FOUND/);
    }
  });

  it('an owner cannot edit or link another studio rows', async () => {
    const c = ownerA.client;
    const upd = await c.from('services').update({price: 1}).eq('id', b.services.wash).select('id');
    expect(upd.data).toEqual([]);
    const ins = await c.from('services').insert({tenant_id: b.id, key: 'evil', name: 'Evil', price: 1, duration_minutes: 30}).select('id');
    expect(ins.error).not.toBeNull();
    // Linking my service to their bay: the composite FK rejects it
    const link = await c.from('service_resources').insert({tenant_id: a.id, service_id: a.services.wash, resource_id: b.resources['bay-1']});
    expect(link.error).not.toBeNull();
    const moveRow = await c.from('services').update({tenant_id: b.id}).eq('id', a.services.wash).select('id');
    expect(moveRow.error).not.toBeNull();
  });

  it('anon reads no tables, tokens or outbox and cannot call server functions', async () => {
    const anon = createClient(env().url, env().anon, {auth: {persistSession: false}});
    for (const table of ['bookings', 'payments', 'booking_access', 'push_subscriptions', 'notification_jobs', 'tenants', 'services']) {
      const {error} = await anon.from(table).select('*').limit(1);
      expect(error?.code, table).toBe('42501');
    }
    for (const fn of ['svc_sync_tenant', 'svc_activate_tenant', 'svc_claim_notification_jobs', 'svc_llm_reserve', 'owner_stats']) {
      const {error} = await anon.rpc(fn, {} as never);
      expect(error, fn).not.toBeNull();
    }
  });

  it('owners cannot read customer tokens or push endpoints even of their own studio', async () => {
    const c = ownerA.client;
    expect((await c.from('booking_access').select('*')).error?.code).toBe('42501');
    expect((await c.from('push_subscriptions').select('*')).error?.code).toBe('42501');
    expect((await c.from('notification_jobs').select('*')).error?.code).toBe('42501');
  });

  it('public data contains no personal data', async () => {
    const {data} = await anonRpc('public_get_tenant', {p_slug: b.slug});
    const text = JSON.stringify(data);
    expect(text).not.toContain('Тест Клиент');
    expect(text).not.toMatch(/\+7988\d{7}/);
    const avail = await anonRpc('public_get_availability', {p_slug: b.slug, p_service_id: b.services.wash, p_days: 3});
    expect(JSON.stringify(avail.data)).not.toContain('customer');
  });

  it('storage: an owner may write only into their studio folder', async () => {
    const c = ownerA.client;
    const png = new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], {type: 'image/png'});
    const mine = await c.storage.from('tenant-media').upload(`${a.id}/test-${key()}.png`, png);
    expect(mine.error).toBeNull();
    const theirs = await c.storage.from('tenant-media').upload(`${b.id}/evil-${key()}.png`, png);
    expect(theirs.error).not.toBeNull();
    const anon = createClient(env().url, env().anon, {auth: {persistSession: false}});
    const anonUp = await anon.storage.from('tenant-media').upload(`${a.id}/anon-${key()}.png`, png);
    expect(anonUp.error).not.toBeNull();
  });

  it('there is no public owner signup', async () => {
    const anon = createClient(env().url, env().anon, {auth: {persistSession: false}});
    const {data, error} = await anon.auth.signUp({email: `intruder-${key()}@test.local`, password: 'Sup3r-secret-pass'});
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it('a signed-in user without membership sees nothing', async () => {
    const email = `stranger-${key()}@test.local`;
    const password = key();
    await admin().auth.admin.createUser({email, password, email_confirm: true});
    const c = createClient(env().url, env().anon, {auth: {persistSession: false}});
    await c.auth.signInWithPassword({email, password});
    expect((await c.from('tenants').select('id')).data).toEqual([]);
    expect((await c.from('bookings').select('id')).data).toEqual([]);
    expect((await c.rpc('owner_stats', {p_tenant_id: a.id, p_period: 'day'})).error?.message).toBe('forbidden');
  });
});
