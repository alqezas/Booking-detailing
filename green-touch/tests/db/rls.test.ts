import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startFakeNp, type FakeNp} from '../fakes/np.ts';
import {admin, anon, checkout, checkoutBody, closeDb, createItem, db, env, makeCtx, tag} from './helpers.ts';

let np: FakeNp;
let user: SupabaseClient;
let owner: SupabaseClient;
let orderId = '';
let itemId = '';
const ids: string[] = [];
const t = tag();

async function signedIn(isAdmin: boolean): Promise<SupabaseClient> {
  const email = `${t}-${randomUUID().slice(0, 6)}@example.test`;
  const password = `P-${randomUUID()}`;
  const {data, error} = await admin().auth.admin.createUser({email, password, email_confirm: true});
  if (error) throw error;
  ids.push(data.user.id);
  if (isAdmin) await db().query('insert into admins (user_id) values ($1)', [data.user.id]);
  const c = createClient(env().url, env().anon, {auth: {persistSession: false, autoRefreshToken: false}});
  const s = await c.auth.signInWithPassword({email, password});
  if (s.error) throw s.error;
  return c;
}

beforeAll(async () => {
  np = await startFakeNp();
  itemId = await createItem({name: `${t} rls`, price_kop: 10000});
  const r = await checkout(makeCtx({npUrl: np.url}), checkoutBody([{id: itemId, qty: 1}]));
  orderId = r.data.order_id;
  user = await signedIn(false);
  owner = await signedIn(true);
});
afterAll(async () => {
  await db().query('delete from orders where id = $1', [orderId]);
  await db().query('delete from items where name like $1', [`${t}%`]);
  for (const id of ids) await admin().auth.admin.deleteUser(id);
  await np.close();
  await closeDb();
});

describe('anonymous visitor', () => {
  it('cannot read orders, payments, outbox or admin-only tables', async () => {
    for (const table of ['orders', 'order_lines', 'payment_attempts', 'payment_events', 'outbox', 'admins']) {
      const {data, error} = await anon().from(table).select('*').limit(1);
      expect(error?.code ?? (data?.length === 0 ? 'empty' : 'LEAK'), table).not.toBe('LEAK');
    }
  });
  it('cannot change products, create orders directly or call service functions', async () => {
    const upd = await anon().from('items').update({price_kop: 1}).eq('id', itemId).select();
    expect(upd.error ?? (upd.data?.length ? 'LEAK' : null)).not.toBe('LEAK');
    const ins = await anon().from('orders').insert({idempotency_key: 'x'.repeat(20)});
    expect(ins.error).not.toBeNull();
    const svc = await anon().rpc('svc_create_order', {p: {}, p_request_hash: 'x', p_token_hash: '\\x00', p_reserve_minutes: 30});
    expect(svc.error).not.toBeNull();
    const pay = await anon().rpc('svc_apply_payment_event', {p: {}});
    expect(pay.error).not.toBeNull();
    expect((await db().query('select price_kop from items where id = $1', [itemId])).rows[0].price_kop).toBe(10000);
  });
  it('cannot guess an order by number or id without the token', async () => {
    const r = await admin().rpc('svc_order_for_guest', {p_order: orderId, p_token_hash: '\\x' + '00'.repeat(32)});
    expect(r.data).toBeNull();
  });
  it('can use the public catalog RPCs and dictionaries', async () => {
    expect((await anon().rpc('catalog_meta')).error).toBeNull();
    expect((await anon().from('facets').select('slug').eq('group_key', 'skin_type')).data).toHaveLength(7);
  });
});

describe('signed-in user without the admin role', () => {
  it('gets no admin rights', async () => {
    expect((await user.rpc('am_i_admin')).data).toBe(false);
    expect((await user.from('orders').select('id')).data).toEqual([]);
    const upd = await user.from('items').update({price_kop: 1}).eq('id', itemId).select();
    expect(upd.data ?? []).toEqual([]);
    const ins = await user.from('admins').insert({user_id: ids[0]});
    expect(ins.error).not.toBeNull();
    const rpc = await user.rpc('admin_update_order', {p_order: orderId, p_fulfillment: 'processing'});
    expect(rpc.error?.message).toBe('FORBIDDEN');
    const items = await user.rpc('admin_items');
    expect(items.error?.message).toBe('FORBIDDEN');
  });
});

describe('admin', () => {
  it('reads orders (without guest token hash) and manages the catalog', async () => {
    const {data, error} = await owner.from('orders').select('id,number,payment_status').eq('id', orderId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const hash = await owner.from('orders').select('access_token_hash').eq('id', orderId);
    expect(hash.error).not.toBeNull();
    const upd = await owner.from('items').update({description: 'Опис'}).eq('id', itemId).select('description');
    expect(upd.data).toEqual([{description: 'Опис'}]);
  });

  it('cannot write payment status; fulfilment of an unpaid order is refused', async () => {
    const direct = await owner.from('orders').update({payment_status: 'paid'}).eq('id', orderId).select();
    expect(direct.error).not.toBeNull();
    const ship = await owner.rpc('admin_update_order', {p_order: orderId, p_fulfillment: 'shipped', p_ttn: '20450000000000'});
    expect(ship.error?.message).toBe('NOT_READY_TO_SHIP');
    const cancel = await owner.rpc('admin_update_order', {p_order: orderId, p_fulfillment: 'cancelled', p_note: 'тест'});
    expect(cancel.error).toBeNull();
    const row = (await db().query('select payment_status, fulfillment_status from orders where id = $1', [orderId])).rows[0];
    expect(row).toEqual({payment_status: 'unpaid', fulfillment_status: 'cancelled'});
  });

  it('a paid order can be processed and shipped with a TTN', async () => {
    await db().query("update orders set payment_status = 'paid', fulfillment_status = 'new', paid_at = now() where id = $1", [orderId]);
    expect((await owner.rpc('admin_update_order', {p_order: orderId, p_fulfillment: 'shipped'})).error?.message).toBe('TTN_REQUIRED');
    expect((await owner.rpc('admin_update_order', {p_order: orderId, p_fulfillment: 'shipped', p_ttn: '2045 0000 0000 00'})).error).toBeNull();
    expect((await db().query('select ttn from orders where id = $1', [orderId])).rows[0].ttn).toBe('20450000000000');
  });

  it('storage: only admins upload, only images', async () => {
    const path = `items/${itemId}/${t}.webp`;
    const png = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], {type: 'image/webp'});
    expect((await anon().storage.from('catalog').upload(path, png)).error).not.toBeNull();
    expect((await user.storage.from('catalog').upload(path, png)).error).not.toBeNull();
    expect((await owner.storage.from('catalog').upload(path, png)).error).toBeNull();
    const exe = new Blob(['MZ'], {type: 'application/x-msdownload'});
    expect((await owner.storage.from('catalog').upload(`items/${itemId}/${t}.exe`, exe)).error).not.toBeNull();
    await owner.storage.from('catalog').remove([path]);
  });
});
