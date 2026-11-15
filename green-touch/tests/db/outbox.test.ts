import {createServer, type Server} from 'node:http';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {processOutbox} from '../../supabase/functions/_shared/handlers.ts';
import {startFakeNp, type FakeNp} from '../fakes/np.ts';
import {admin, checkout, checkoutBody, closeDb, createItem, db, makeCtx, tag} from './helpers.ts';

let np: FakeNp;
let tg: Server;
let tgCalls = 0;
let tgFail = false;
let tgUrl = '';
const t = tag();
let orderId = '';

beforeAll(async () => {
  np = await startFakeNp();
  tg = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      tgCalls++;
      res.writeHead(tgFail ? 502 : 200, {'content-type': 'application/json'});
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>(r => tg.listen(0, '127.0.0.1', r));
  tgUrl = `http://127.0.0.1:${(tg.address() as {port: number}).port}`;
  const item = await createItem({name: `${t} outbox`, price_kop: 10000});
  const r = await checkout(makeCtx({npUrl: np.url}), checkoutBody([{id: item, qty: 1}]));
  orderId = r.data.order_id;
  // drain whatever earlier test files left behind
  await db().query("update outbox set status = 'done' where status <> 'done'");
});
afterAll(async () => {
  await db().query('delete from orders where id = $1', [orderId]);
  await db().query('delete from items where name like $1', [`${t}%`]);
  await new Promise(r => tg.close(r));
  await np.close();
  await closeDb();
});

const enqueue = async (n: number, topic = 'order.paid') => {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await db().query('insert into outbox (topic, order_id, payload, dedupe_key) values ($1, $2, $3, $4) returning id', [topic, orderId, {i}, `${t}:${topic}:${i}:${Math.random()}`]);
    ids.push(Number(r.rows[0].id));
  }
  return ids;
};

describe('outbox', () => {
  it('concurrent workers claim disjoint rows (SKIP LOCKED)', async () => {
    const ids = await enqueue(30, 'test.claim');
    const claims = await Promise.all(['w1', 'w2', 'w3', 'w4'].map(w => admin().rpc('svc_claim_outbox', {p_worker: w, p_limit: 10, p_lease_s: 60})));
    const got = claims.flatMap(c => (c.data as {id: number}[]).map(r => Number(r.id)));
    expect(new Set(got).size).toBe(got.length);
    expect(got.sort((a, b) => a - b)).toEqual(ids);
    await db().query("update outbox set status = 'done' where id = any($1)", [ids]);
  });

  it('an expired lease can be taken over; the stale worker cannot complete it', async () => {
    const [id] = await enqueue(1, 'test.lease');
    await admin().rpc('svc_claim_outbox', {p_worker: 'slow', p_limit: 1, p_lease_s: 60});
    await db().query("update outbox set locked_until = now() - interval '1 second' where id = $1", [id]);
    const {data} = await admin().rpc('svc_claim_outbox', {p_worker: 'fast', p_limit: 5, p_lease_s: 60});
    expect((data as {id: number}[]).map(r => Number(r.id))).toContain(id);
    expect((await admin().rpc('svc_complete_outbox', {p_id: id, p_worker: 'slow'})).data).toBe(false);
    expect((await admin().rpc('svc_complete_outbox', {p_id: id, p_worker: 'fast'})).data).toBe(true);
  });

  it('consumers are idempotent: one timeline row and one notification per event', async () => {
    const ctx = makeCtx({npUrl: np.url, telegramUrl: tgUrl});
    const [id] = await enqueue(1, 'order.paid');
    tgCalls = 0;
    expect(await processOutbox(ctx, 'w-a')).toEqual({done: 1, failed: 0});
    // replay the same event (e.g. a worker crashed after the side effect)
    await db().query("update outbox set status = 'pending', available_at = now() where id = $1", [id]);
    expect(await processOutbox(ctx, 'w-b')).toEqual({done: 1, failed: 0});
    expect(tgCalls).toBe(1);
    const tl = await db().query('select count(*)::int as n from order_timeline where outbox_id = $1', [id]);
    expect(tl.rows[0].n).toBe(1);
  });

  it('failures retry with backoff, become dead after max attempts, and can be retried', async () => {
    const ctx = makeCtx({npUrl: np.url, telegramUrl: tgUrl});
    const [id] = await enqueue(1, 'order.paid');
    await db().query('update outbox set max_attempts = 3 where id = $1', [id]);
    tgFail = true;
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      await db().query('update outbox set available_at = now() where id = $1 and status = $2', [id, 'pending']);
      expect(await processOutbox(ctx, `w${i}`)).toEqual({done: 0, failed: 1});
      const row = (await db().query('select status, attempts, extract(epoch from available_at - now()) as wait, last_error from outbox where id = $1', [id])).rows[0];
      delays.push(Number(row.wait));
      expect(row.last_error).toMatch(/telegram http 502/);
      expect(row.status).toBe(i < 2 ? 'pending' : 'dead');
    }
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
    tgFail = false;
    // the event is not lost: an admin retry puts it back
    await db().query("update outbox set status = 'pending', attempts = 0, available_at = now() where id = $1 and status = 'dead'", [id]);
    expect(await processOutbox(ctx, 'w-retry')).toEqual({done: 1, failed: 0});
  });
});
