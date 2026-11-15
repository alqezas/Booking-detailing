import {createServer, type Server} from 'node:http';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Ctx} from '../../supabase/functions/_shared/ctx.ts';
import {handleLiqPayCallback, runJobs} from '../../supabase/functions/_shared/handlers.ts';
import {decodeData, sign} from '../../supabase/functions/_shared/liqpay.ts';
import {startFakeLiqPay, type FakeLiqPay} from '../fakes/liqpay.ts';
import {startFakeNp, type FakeNp} from '../fakes/np.ts';
import {checkout, checkoutBody, closeDb, createItem, db, guest, makeCtx, orderRow, tag} from './helpers.ts';

let lp: FakeLiqPay;
let np: FakeNp;
let sink: Server;
let ctx: Ctx;
const t = tag();

beforeAll(async () => {
  lp = await startFakeLiqPay();
  np = await startFakeNp();
  // Receives the fake provider's callbacks and runs the real callback handler on them.
  sink = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const r = await handleLiqPayCallback(new Request('http://local/liqpay-callback', {method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks)}), ctx);
      res.writeHead(r.status, {'content-type': 'application/json'});
      res.end(await r.text());
    });
  });
  await new Promise<void>(r => sink.listen(0, '127.0.0.1', r));
  ctx = {...makeCtx({liqpay: {url: lp.url}, npUrl: np.url}), callbackUrl: `http://127.0.0.1:${(sink.address() as {port: number}).port}/`};
});
afterAll(async () => {
  await db().query('delete from orders where id in (select order_id from order_lines where name like $1)', [`${t}%`]);
  await db().query('delete from items where name like $1', [`${t}%`]);
  await new Promise(r => sink.close(r));
  await lp.close();
  await np.close();
  await closeDb();
});

type Placed = {item: string; order_id: string; token: string; total_kop: number; payment: {state: string; checkout?: {url: string; data: string; signature: string}}};

/** Checkout → the browser opens the LiqPay page (POST data+signature). Returns the LiqPay order_id. */
async function placeOrder(name: string, price = 50000): Promise<Placed & {poid: string}> {
  const item = await createItem({name: `${t} ${name}`, price_kop: price});
  const r = await checkout(ctx, checkoutBody([{id: item, qty: 1}]));
  expect(r.status).toBe(200);
  const o = {item, ...r.data} as Placed;
  expect(o.payment.state).toBe('redirect');
  expect(await lp.openCheckout(o.payment.checkout!)).toBe(303);
  return {...o, poid: (decodeData(o.payment.checkout!.data) as {order_id: string}).order_id};
}

const postCallback = async (body: {data: string; signature: string}) => {
  const r = await handleLiqPayCallback(
    new Request('http://local/liqpay-callback', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)}),
    ctx,
  );
  return {status: r.status, data: await r.json()};
};

describe('checkout payload', () => {
  it('is signed with sha3-256 and carries the server amount, currency and a unique order_id', async () => {
    const o = await placeOrder('payload', 123456);
    const c = o.payment.checkout!;
    expect(c.url).toBe(`${lp.url}/api/3/checkout`);
    expect(c.signature).toBe(sign(ctx.liqpay!, c.data));
    const d = decodeData(c.data) as Record<string, unknown>;
    expect(d).toMatchObject({version: 3, action: 'pay', amount: '1234.56', currency: 'UAH', public_key: 'sandbox_test_public', result_url: `http://localhost:4180/zamovlennia/${o.order_id}`, sandbox: 1});
    expect(String(d.order_id)).toMatch(/^GT-\d+-[0-9a-f]{10}$/);
    expect(String(d.expired_date)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(JSON.stringify(d)).not.toContain('sandbox_test_private');
  });
});

describe('happy path', () => {
  it('a signed callback confirms the payment; the redirect alone does not', async () => {
    const o = await placeOrder('happy');
    expect((await orderRow(o.order_id)).payment_status).toBe('awaiting');
    const before = await guest(ctx, {order_id: o.order_id, token: o.token});
    expect(before.data.order.payment_status).toBe('awaiting');
    await lp.setStatus(o.poid, 'processing');
    const w = await lp.setStatus(o.poid, 'sandbox');
    expect(w.status).toBe(200);
    expect(await orderRow(o.order_id)).toMatchObject({payment_status: 'paid', fulfillment_status: 'new', needs_review: false});
    const out = await db().query('select topic from outbox where order_id = $1 order by id', [o.order_id]);
    expect(out.rows.map(r => r.topic)).toEqual(['order.created', 'order.paid']);
  });
});

describe('callback verification', () => {
  it('rejects a missing, foreign-key or tampered signature and changes nothing', async () => {
    const o = await placeOrder('sig');
    const p = lp.payments.get(o.poid)!;
    const good = lp.callbackBody(p, {status: 'success'});
    expect((await postCallback({data: good.data, signature: ''})).status).toBe(401);
    const foreign = sign({...ctx.liqpay!, privateKey: 'someone-else'}, good.data);
    expect((await postCallback({data: good.data, signature: foreign})).status).toBe(401);
    const tampered = Buffer.from(Buffer.from(good.data, 'base64').toString().replace('"amount":500', '"amount":5')).toString('base64');
    expect((await postCallback({data: tampered, signature: good.signature})).status).toBe(401);
    expect((await orderRow(o.order_id)).payment_status).toBe('awaiting');
    expect((await postCallback(good)).data.outcome).toBe('applied');
    expect((await orderRow(o.order_id)).payment_status).toBe('paid');
  });

  it('wrong amount, wrong currency, unknown order_id: recorded, never paid', async () => {
    const o = await placeOrder('mismatch');
    const p = lp.payments.get(o.poid)!;
    expect((await postCallback(lp.callbackBody(p, {status: 'success', amount: 1, payment_id: 1}))).data.outcome).toBe('mismatch');
    expect((await postCallback(lp.callbackBody(p, {status: 'success', currency: 'USD', payment_id: 2}))).data.outcome).toBe('mismatch');
    expect((await postCallback(lp.callbackBody(p, {status: 'success', order_id: `GT-0-${t}`}))).data.outcome).toBe('unknown_order');
    const row = await orderRow(o.order_id);
    expect(row.payment_status).toBe('awaiting');
    expect(row.review_reasons).toContain('payment_amount_mismatch');
  });

  it('duplicates are idempotent and a lower status never overrides a higher one', async () => {
    const o = await placeOrder('order');
    const p = lp.payments.get(o.poid)!;
    const success = lp.callbackBody(p, {status: 'success'});
    const processing = lp.callbackBody(p, {status: 'processing'});
    const failure = lp.callbackBody(p, {status: 'failure'});
    expect((await postCallback(success)).data.outcome).toBe('applied');
    expect((await postCallback(processing)).data.outcome).toBe('stale');
    expect((await postCallback(failure)).data.outcome).toBe('stale');
    expect((await postCallback(success)).data.outcome).toBe('duplicate');
    expect((await orderRow(o.order_id)).payment_status).toBe('paid');
    const paid = await db().query("select count(*)::int as n from outbox where order_id = $1 and topic = 'order.paid'", [o.order_id]);
    expect(paid.rows[0].n).toBe(1);
  });

  it('reversed after success goes to owner review', async () => {
    const o = await placeOrder('reversed');
    await lp.setStatus(o.poid, 'success');
    await lp.setStatus(o.poid, 'reversed');
    const row = await orderRow(o.order_id);
    expect(row).toMatchObject({payment_status: 'reversed', needs_review: true});
  });
});

describe('failures and retries', () => {
  it('failure → the buyer pays again with a new LiqPay order_id for the same order', async () => {
    const o = await placeOrder('retry');
    await lp.setStatus(o.poid, 'failure');
    expect((await orderRow(o.order_id)).payment_status).toBe('failed');
    const again = await guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'});
    expect(again.data.payment.state).toBe('redirect');
    const poid2 = (decodeData(again.data.payment.checkout.data) as {order_id: string}).order_id;
    expect(poid2).not.toBe(o.poid);
    await lp.openCheckout(again.data.payment.checkout);
    await lp.setStatus(poid2, 'success');
    expect((await orderRow(o.order_id)).payment_status).toBe('paid');
    const after = await guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'});
    expect(after.data.payment.state).toBe('paid');
  });

  it('parallel «pay» requests reuse one live payment instead of creating more', async () => {
    const o = await placeOrder('double');
    await lp.setStatus(o.poid, 'failure');
    const rs = await Promise.all([1, 2, 3, 4].map(() => guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'})));
    const poids = new Set(rs.filter(r => r.data.payment.state === 'redirect').map(r => (decodeData(r.data.payment.checkout.data) as {order_id: string}).order_id));
    expect(poids.size).toBe(1);
    const open = await db().query("select count(*)::int as n from payment_attempts where order_id = $1 and status in ('creating','created','processing')", [o.order_id]);
    expect(open.rows[0].n).toBe(1);
  });

  it('LiqPay keys missing: the order is still saved and can be paid later', async () => {
    const off = {...ctx, liqpay: null};
    const item = await createItem({name: `${t} nokeys`, price_kop: 10000});
    const r = await checkout(off, checkoutBody([{id: item, qty: 1}]));
    expect(r.status).toBe(200);
    expect(r.data.payment.state).toBe('unavailable');
    expect((await orderRow(r.data.order_id)).payment_status).toBe('unpaid');
    const later = await guest(ctx, {order_id: r.data.order_id, token: r.data.token, action: 'pay'});
    expect(later.data.payment.state).toBe('redirect');
  });

  it('crash between preparing and saving a payment: recovered after the lease', async () => {
    const item = await createItem({name: `${t} crash`, price_kop: 10000});
    const r = await checkout({...ctx, liqpay: null}, checkoutBody([{id: item, qty: 1}]));
    const {data} = await ctx.db.rpc('svc_begin_payment', {p_order: r.data.order_id, p_validity_minutes: 60});
    expect(data.state).toBe('new');
    const blocked = await guest(ctx, {order_id: r.data.order_id, token: r.data.token, action: 'pay'});
    expect(blocked.data.payment.state).toBe('in_progress');
    await db().query("update payment_attempts set created_at = now() - interval '2 minutes' where order_id = $1 and status = 'creating'", [r.data.order_id]);
    const ok = await guest(ctx, {order_id: r.data.order_id, token: r.data.token, action: 'pay'});
    expect(ok.data.payment.state).toBe('redirect');
    const st = await db().query('select status from payment_attempts where order_id = $1 order by created_at', [r.data.order_id]);
    expect(st.rows.map(x => x.status)).toEqual(['abandoned', 'created']);
  });

  it('lost callback: the status page asks LiqPay (action=status)', async () => {
    const o = await placeOrder('lost');
    await lp.setStatus(o.poid, 'success', {callback: false});
    expect((await orderRow(o.order_id)).payment_status).toBe('awaiting');
    await db().query("update payment_attempts set created_at = now() - interval '2 minutes' where order_id = $1", [o.order_id]);
    const g = await guest(ctx, {order_id: o.order_id, token: o.token});
    expect(g.data.order.payment_status).toBe('paid');
    const ev = await db().query('select source, outcome from payment_events where provider_order_id = $1', [o.poid]);
    expect(ev.rows).toEqual([{source: 'reconcile', outcome: 'applied'}]);
  });

  it('an unpaid payment past its validity is expired by the background job', async () => {
    const o = await placeOrder('expired');
    await db().query("update payment_attempts set expires_at = now() - interval '1 minute', next_check_at = now() - interval '1 second' where order_id = $1", [o.order_id]);
    const report = await runJobs(ctx, 'test-worker');
    expect(report.reconciled).toBeGreaterThanOrEqual(1);
    expect((await orderRow(o.order_id)).payment_status).toBe('expired');
    const again = await guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'});
    expect(again.data.payment.state).toBe('redirect');
  });

  it('service role is not an admin: shipping RPC is refused', async () => {
    const o = await placeOrder('ship');
    const {error} = await ctx.db.rpc('admin_update_order', {p_order: o.order_id, p_fulfillment: 'shipped', p_ttn: '20450000000000'});
    expect(error?.message).toBe('FORBIDDEN');
  });
});
