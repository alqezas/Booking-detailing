import {createServer, type Server} from 'node:http';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Ctx} from '../../supabase/functions/_shared/ctx.ts';
import {handleMonoWebhook, runJobs} from '../../supabase/functions/_shared/handlers.ts';
import {resetMonoKeyCache} from '../../supabase/functions/_shared/mono.ts';
import {startFakeMono, type FakeMono} from '../fakes/mono.ts';
import {startFakeNp, type FakeNp} from '../fakes/np.ts';
import {checkout, checkoutBody, closeDb, createItem, db, guest, makeCtx, orderRow, tag} from './helpers.ts';

let mono: FakeMono;
let np: FakeNp;
let sink: Server;
let ctx: Ctx;
const t = tag();

beforeAll(async () => {
  mono = await startFakeMono();
  np = await startFakeNp();
  // Receives the fake provider's webhooks and runs the real webhook handler on them.
  sink = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const r = await handleMonoWebhook(new Request('http://local/mono-webhook', {method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks)}), ctx);
      res.writeHead(r.status, {'content-type': 'application/json'});
      res.end(await r.text());
    });
  });
  await new Promise<void>(r => sink.listen(0, '127.0.0.1', r));
  ctx = {...makeCtx({monoUrl: mono.url, npUrl: np.url}), webhookUrl: `http://127.0.0.1:${(sink.address() as {port: number}).port}/`};
  resetMonoKeyCache();
});
afterAll(async () => {
  await db().query('delete from orders where id in (select order_id from order_lines where name like $1)', [`${t}%`]);
  await db().query('delete from items where name like $1', [`${t}%`]);
  await new Promise(r => sink.close(r));
  await mono.close();
  await np.close();
  await closeDb();
});

const invoiceOf = async (orderId: string) =>
  (await db().query('select provider_order_id as invoice_id, status from payment_attempts where order_id = $1 and provider_order_id is not null order by created_at desc limit 1', [orderId])).rows[0] as {
    invoice_id: string;
    status: string;
  };

const postWebhook = async (body: string, sign: string) => {
  const r = await handleMonoWebhook(new Request('http://local/mono-webhook', {method: 'POST', headers: {'content-type': 'application/json', 'x-sign': sign}, body}), ctx);
  return {status: r.status, data: await r.json()};
};

async function placeOrder(name: string, price = 50000, method: 'full_online' | 'prepay_manual' = 'full_online') {
  const item = await createItem({name: `${t} ${name}`, price_kop: price});
  const r = await checkout(ctx, checkoutBody([{id: item, qty: 1}], {payment_method: method}));
  expect(r.status).toBe(200);
  return {item, ...r.data} as {item: string; order_id: string; token: string; total_kop: number; payment: {state: string; page_url?: string}};
}

describe('full online payment (mono)', () => {
  it('creates an invoice; a signed webhook confirms the payment; the redirect alone does not', async () => {
    const o = await placeOrder('happy');
    expect(o.payment.state).toBe('redirect');
    expect(o.payment.page_url).toMatch(/\/pay\/inv_/);
    const inv = await invoiceOf(o.order_id);
    expect(mono.invoices.get(inv.invoice_id)).toMatchObject({amount: 50000, ccy: 980, validity: 1440 * 60});
    expect((await guest(ctx, {order_id: o.order_id, token: o.token})).data.order.payment_status).toBe('awaiting');
    await mono.setStatus(inv.invoice_id, 'processing');
    expect((await mono.setStatus(inv.invoice_id, 'success')).status).toBe(200);
    expect(await orderRow(o.order_id)).toMatchObject({payment_status: 'paid', payment_method: 'full_online', needs_review: false});
    const out = await db().query('select topic from outbox where order_id = $1 order by id', [o.order_id]);
    expect(out.rows.map(r => r.topic)).toEqual(['order.created', 'order.paid']);
  });

  it('rejects a missing, foreign or tampered signature and changes nothing', async () => {
    const o = await placeOrder('sig');
    const inv = await invoiceOf(o.order_id);
    const body = mono.statusBody(mono.invoices.get(inv.invoice_id)!, {status: 'success', modifiedDate: new Date().toISOString()});
    expect((await postWebhook(body, '')).status).toBe(401);
    expect((await postWebhook(body, mono.signWithOtherKey(body))).status).toBe(401);
    const sign = mono.signBody(body);
    expect((await postWebhook(body.replace('"amount":50000', '"amount":50001'), sign)).status).toBe(401);
    expect((await orderRow(o.order_id)).payment_status).toBe('awaiting');
    expect((await postWebhook(body, sign)).data.outcome).toBe('applied');
    expect((await orderRow(o.order_id)).payment_status).toBe('paid');
  });

  it('wrong amount, wrong currency, unknown invoice: recorded, never paid', async () => {
    const o = await placeOrder('mismatch');
    const inv = mono.invoices.get((await invoiceOf(o.order_id)).invoice_id)!;
    const at = () => new Date(Date.now() + Math.random() * 1000).toISOString();
    const amount = mono.statusBody(inv, {status: 'success', amount: 100, modifiedDate: at()});
    expect((await postWebhook(amount, mono.signBody(amount))).data.outcome).toBe('mismatch');
    const ccy = mono.statusBody(inv, {status: 'success', ccy: 840, modifiedDate: at()});
    expect((await postWebhook(ccy, mono.signBody(ccy))).data.outcome).toBe('mismatch');
    const unknown = mono.statusBody(inv, {status: 'success', invoiceId: `inv_${t}`, modifiedDate: at()});
    expect((await postWebhook(unknown, mono.signBody(unknown))).data.outcome).toBe('unknown_invoice');
    const row = await orderRow(o.order_id);
    expect(row.payment_status).toBe('awaiting');
    expect(row.review_reasons).toContain('payment_amount_mismatch');
  });

  it('duplicates are idempotent and an older event never overrides a newer one', async () => {
    const o = await placeOrder('order');
    const inv = mono.invoices.get((await invoiceOf(o.order_id)).invoice_id)!;
    const t0 = Date.now();
    const processing = mono.statusBody(inv, {status: 'processing', modifiedDate: new Date(t0 + 1000).toISOString()});
    const success = mono.statusBody(inv, {status: 'success', modifiedDate: new Date(t0 + 2000).toISOString()});
    expect((await postWebhook(success, mono.signBody(success))).data.outcome).toBe('applied');
    expect((await postWebhook(processing, mono.signBody(processing))).data.outcome).toBe('stale');
    expect((await postWebhook(success, mono.signBody(success))).data.outcome).toBe('duplicate');
    expect((await orderRow(o.order_id)).payment_status).toBe('paid');
  });

  it('failure → pay again with a new invoice for the same order', async () => {
    const o = await placeOrder('retry');
    const first = await invoiceOf(o.order_id);
    await mono.setStatus(first.invoice_id, 'failure');
    expect((await orderRow(o.order_id)).payment_status).toBe('failed');
    const again = await guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'});
    expect(again.data.payment.state).toBe('redirect');
    const second = await invoiceOf(o.order_id);
    expect(second.invoice_id).not.toBe(first.invoice_id);
    await mono.setStatus(second.invoice_id, 'success');
    expect((await orderRow(o.order_id)).payment_status).toBe('paid');
  });

  it('parallel «pay» requests never create two live invoices', async () => {
    const o = await placeOrder('double');
    await mono.setStatus((await invoiceOf(o.order_id)).invoice_id, 'failure');
    const before = mono.invoices.size;
    mono.setCreateDelay(300);
    await Promise.all([1, 2, 3].map(() => guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'})));
    mono.setCreateDelay(0);
    expect(mono.invoices.size - before).toBe(1);
  });

  it('provider down while creating the invoice: the order survives and can be paid later', async () => {
    mono.failCreates(3);
    const o = await placeOrder('partial');
    expect(o.payment.state).toBe('unavailable');
    expect((await orderRow(o.order_id)).payment_status).toBe('unpaid');
    expect((await guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'})).data.payment.state).toBe('redirect');
  });

  it('lost webhook → status page reconciles; expired invoice → background job', async () => {
    const o = await placeOrder('lost');
    const inv = await invoiceOf(o.order_id);
    await mono.setStatus(inv.invoice_id, 'success', {webhook: false});
    await db().query("update payment_attempts set created_at = now() - interval '2 minutes' where order_id = $1", [o.order_id]);
    expect((await guest(ctx, {order_id: o.order_id, token: o.token})).data.order.payment_status).toBe('paid');

    const e = await placeOrder('expired');
    await mono.setStatus((await invoiceOf(e.order_id)).invoice_id, 'expired', {webhook: false});
    await db().query("update payment_attempts set next_check_at = now() - interval '1 second' where order_id = $1", [e.order_id]);
    await runJobs(ctx, 'test-worker');
    expect((await orderRow(e.order_id)).payment_status).toBe('expired');
  });
});

describe('prepayment 150 грн (arranged in Viber, nothing paid on the site)', () => {
  it('creates no invoice; stores the prepayment and the cash-on-delivery remainder', async () => {
    const before = mono.invoices.size;
    const o = await placeOrder('prepay', 90000, 'prepay_manual');
    expect(o.payment.state).toBe('manual');
    expect(mono.invoices.size).toBe(before);
    expect(await orderRow(o.order_id)).toMatchObject({payment_method: 'prepay_manual', prepay_kop: 15000, payment_status: 'unpaid', prepay_received_at: null});
    const g = await guest(ctx, {order_id: o.order_id, token: o.token});
    expect(g.data.order).toMatchObject({payment_method: 'prepay_manual', prepay_kop: 15000, cod_kop: 75000, can_pay: false, prepay_received: false});
    const pay = await guest(ctx, {order_id: o.order_id, token: o.token, action: 'pay'});
    expect(pay.data.error).toBe('NOT_ONLINE_PAYMENT');
  });

  it('is refused when the order total is not above the prepayment', async () => {
    const item = await createItem({name: `${t} cheap`, price_kop: 10000});
    const r = await checkout(ctx, checkoutBody([{id: item, qty: 1}], {payment_method: 'prepay_manual'}));
    expect(r.data.error).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('the payment option is part of the idempotency fingerprint', async () => {
    const item = await createItem({name: `${t} fp`, price_kop: 50000});
    const body = checkoutBody([{id: item, qty: 1}], {payment_method: 'prepay_manual'});
    expect((await checkout(ctx, body)).status).toBe(200);
    const changed = await checkout(ctx, {...body, payment_method: 'full_online'});
    expect(changed.data.error).toBe('IDEMPOTENCY_MISMATCH');
  });
});
