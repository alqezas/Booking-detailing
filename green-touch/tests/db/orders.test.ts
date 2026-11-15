import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Ctx} from '../../supabase/functions/_shared/ctx.ts';
import {clearNpCache} from '../../supabase/functions/_shared/np.ts';
import {NP_FIX, NP_POINTS, startFakeNp, type FakeNp} from '../fakes/np.ts';
import {checkout, checkoutBody, closeDb, createItem, db, guest, makeCtx, orderRow, tag} from './helpers.ts';

let np: FakeNp;
let ctx: Ctx; // payments not configured here: orders are saved, payment reported unavailable
const t = tag();

beforeAll(async () => {
  np = await startFakeNp();
  ctx = makeCtx({npUrl: np.url});
});
afterAll(async () => {
  await db().query('delete from orders where id in (select order_id from order_lines where name like $1)', [`${t}%`]);
  await db().query("delete from items where kind = 'kit' and name like $1", [`${t}%`]);
  await db().query('delete from items where name like $1', [`${t}%`]);
  await np.close();
  await closeDb();
});

describe('server-side pricing', () => {
  it('ignores prices sent by the client and recomputes from the database', async () => {
    const a = await createItem({name: `${t} price a`, price_kop: 95000});
    const body = checkoutBody([{id: a, qty: 2, unit_price_kop: 1, price: 1} as never], {total_kop: 100});
    const r = await checkout(ctx, body);
    expect(r.status).toBe(200);
    expect(r.data.total_kop).toBe(190000);
    const o = await orderRow(r.data.order_id);
    expect(o.total_kop).toBe(190000);
    expect(r.data.payment.state).toBe('unavailable');
  });

  it('rejects an outdated client total with PRICE_CHANGED and creates nothing', async () => {
    const a = await createItem({name: `${t} price b`, price_kop: 40000});
    const body = checkoutBody([{id: a, qty: 1}], {expected_total_kop: 35000});
    const r = await checkout(ctx, body);
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({error: 'PRICE_CHANGED', details: {total_kop: 40000}});
    expect((await db().query('select 1 from orders where idempotency_key = $1', [body.idempotency_key])).rowCount).toBe(0);
  });
});

describe('kits: −15 % once, snapshot of composition', () => {
  it('prices a kit from current component prices, applies the discount once, keeps history', async () => {
    const cream = await createItem({name: `${t} kit cream`, price_kop: 110000});
    const serum = await createItem({name: `${t} kit serum`, price_kop: 50000});
    const tonic = await createItem({name: `${t} kit tonic`, price_kop: 40000});
    // base 1100 + 2×500 = 2100 грн; discount round(2100×0.15) = 315 → 1785 грн
    const kit = await createItem({name: `${t} kit A`, kind: 'kit', components: [{id: cream, qty: 1}, {id: serum, qty: 2}]});
    const body = checkoutBody([{id: kit, qty: 2}, {id: tonic, qty: 1}], {expected_total_kop: 2 * 178500 + 40000});
    const r = await checkout(ctx, body);
    expect(r.status).toBe(200);
    expect(r.data.total_kop).toBe(2 * 178500 + 40000);
    const o = await orderRow(r.data.order_id);
    expect([o.subtotal_kop, o.discount_kop, o.total_kop]).toEqual([2 * 210000 + 40000, 2 * 31500, 2 * 178500 + 40000]);

    // Owner changes prices and composition afterwards: the order does not change.
    await db().query('update items set price_kop = 130000 where id = $1', [cream]);
    await db().query('delete from kit_components where kit_id = $1 and product_id = $2', [kit, serum]);
    const lines = (
      await db().query(
        `select l.kind, l.qty, l.unit_base_kop, l.unit_discount_kop, l.unit_price_kop, l.line_total_kop, l.discount_bp,
                (select json_agg(json_build_object('name', c.name, 'qty', c.qty_per_kit, 'price', c.unit_price_kop) order by c.sort)
                 from order_line_components c where c.line_id = l.id) as comps
         from order_lines l where l.order_id = $1 order by l.line_no`,
        [r.data.order_id],
      )
    ).rows;
    expect(lines[0]).toMatchObject({kind: 'kit', qty: 2, unit_base_kop: 210000, unit_discount_kop: 31500, unit_price_kop: 178500, line_total_kop: 357000, discount_bp: 1500});
    expect(lines[0].comps).toEqual([
      {name: `${t} kit cream`, qty: 1, price: 110000},
      {name: `${t} kit serum`, qty: 2, price: 50000},
    ]);
    expect(lines[1]).toMatchObject({kind: 'product', unit_price_kop: 40000, unit_discount_kop: 0});

    // Guest view shows the same historical data.
    const g = await guest(ctx, {order_id: r.data.order_id, token: r.data.token});
    expect(g.data.order.lines[0].components).toHaveLength(2);
    expect(g.data.order.total_kop).toBe(397000);
    // The kit's current price follows the new composition (1300 → −15 % = 1105).
    const {rows} = await db().query("select public.quote_cart($1::jsonb) as q", [JSON.stringify([{id: kit, qty: 1}])]);
    expect(rows[0].q.lines[0]).toMatchObject({unit_base_kop: 130000, unit_discount_kop: 19500, unit_price_kop: 110500});
  });

  it('adding the same kit twice in one request merges lines and still discounts once per kit', async () => {
    const p = await createItem({name: `${t} merge p`, price_kop: 33333});
    const kit = await createItem({name: `${t} kit merge`, kind: 'kit', components: [{id: p, qty: 1}]});
    // 333.33 × 0.15 = 49.9995 → 50.00 (half up to a kopeck) → 283.33
    const r = await checkout(ctx, checkoutBody([{id: kit, qty: 1}, {id: kit, qty: 2}]));
    expect(r.status).toBe(200);
    expect(r.data.total_kop).toBe(3 * (33333 - 5000));
  });
});

describe('idempotency', () => {
  it('the same key returns the same order and token; changed content is rejected', async () => {
    const a = await createItem({name: `${t} idem`, price_kop: 50000});
    const body = checkoutBody([{id: a, qty: 1}]);
    const [r1, r2] = await Promise.all([checkout(ctx, body), checkout(ctx, body)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.data.order_id).toBe(r2.data.order_id);
    expect(r1.data.token).toBe(r2.data.token);
    expect([r1.data.existing, r2.data.existing].sort()).toEqual([false, true]);
    const changed = await checkout(ctx, {...body, lines: [{id: a, qty: 2}]});
    expect(changed.status).toBe(409);
    expect(changed.data.error).toBe('IDEMPOTENCY_MISMATCH');
    expect((await db().query('select count(*)::int as n from orders where idempotency_key = $1', [body.idempotency_key])).rows[0].n).toBe(1);
  });
});

describe('made to order (no stock)', () => {
  it('any quantity can be ordered; concurrent orders never block each other', async () => {
    const p = await createItem({name: `${t} made to order`, price_kop: 60000});
    const results = await Promise.all(Array.from({length: 6}, () => checkout(ctx, checkoutBody([{id: p, qty: 50}]))));
    expect(results.every(r => r.status === 200)).toBe(true);
  });

  it('an item the owner paused blocks itself and every kit that contains it, atomically', async () => {
    const ok = await createItem({name: `${t} ok item`, price_kop: 10000});
    const off = await createItem({name: `${t} paused`, price_kop: 10000, orderable: false});
    const kit = await createItem({name: `${t} kit paused`, kind: 'kit', components: [{id: off, qty: 1}, {id: ok, qty: 1}]});
    const body = checkoutBody([{id: ok, qty: 2}, {id: kit, qty: 1}]);
    const r = await checkout(ctx, body);
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('ITEM_UNAVAILABLE');
    expect(r.data.details.map((d: {id: string}) => d.id)).toEqual([kit]);
    expect((await db().query('select 1 from orders where idempotency_key = $1', [body.idempotency_key])).rowCount).toBe(0);
  });
});

describe('Nova Poshta checks on the server', () => {
  it('accepts a point of the chosen settlement and stores names from the API', async () => {
    const a = await createItem({name: `${t} np ok`, price_kop: 10000});
    const r = await checkout(ctx, checkoutBody([{id: a, qty: 1}]));
    const o = await orderRow(r.data.order_id);
    expect(o).toMatchObject({np_settlement_name: 'Київ', np_area: 'Київська', np_warehouse_number: '1', np_warehouse_ref: NP_POINTS.kyivBranch1, np_city_ref: NP_FIX.kyiv.city});
    expect(o.np_warehouse_name).toMatch(/^Відділення №1/);
  });

  it('rejects a point from another settlement with the same name', async () => {
    const a = await createItem({name: `${t} np city`, price_kop: 10000});
    const body = checkoutBody([{id: a, qty: 1}], {
      delivery: {method: 'np_branch', settlement_ref: NP_FIX.bilaKyivska.settlement, city_ref: NP_FIX.bilaKyivska.city, warehouse_ref: NP_POINTS.bilaZakarpatskaPoint},
    });
    const r = await checkout(ctx, body);
    expect(r.status).toBe(422);
    expect(r.data.error).toBe('NP_POINT_INVALID');
  });

  it('rejects a postomat for «відділення» and a branch for «поштомат»', async () => {
    const a = await createItem({name: `${t} np type`, price_kop: 10000});
    const kyiv = {settlement_ref: NP_FIX.kyiv.settlement, city_ref: NP_FIX.kyiv.city};
    const r1 = await checkout(ctx, checkoutBody([{id: a, qty: 1}], {delivery: {method: 'np_branch', ...kyiv, warehouse_ref: NP_POINTS.kyivPostomat1}}));
    const r2 = await checkout(ctx, checkoutBody([{id: a, qty: 1}], {delivery: {method: 'np_postomat', ...kyiv, warehouse_ref: NP_POINTS.kyivBranch1}}));
    const r3 = await checkout(ctx, checkoutBody([{id: a, qty: 1}], {delivery: {method: 'np_postomat', ...kyiv, warehouse_ref: NP_POINTS.kyivPostomat1}}));
    expect([r1.data.error, r2.data.error, r3.status]).toEqual(['NP_POINT_INVALID', 'NP_POINT_INVALID', 200]);
  });

  it('free text instead of a chosen Ref is refused by validation', async () => {
    const a = await createItem({name: `${t} np text`, price_kop: 10000});
    const body = checkoutBody([{id: a, qty: 1}], {delivery: {method: 'np_branch', settlement_ref: 'Київ', city_ref: 'Київ', warehouse_ref: 'Відділення 1'}});
    const r = await checkout(ctx, body);
    expect(r.status).toBe(400);
    expect(r.data.details.fields.map((f: {path: string}) => f.path)).toEqual(['delivery.settlement_ref', 'delivery.city_ref', 'delivery.warehouse_ref']);
  });

  it('NP API down: no order is created and the buyer gets NP_UNAVAILABLE', async () => {
    const a = await createItem({name: `${t} np down`, price_kop: 10000});
    np.setDown(true);
    clearNpCache();
    const body = checkoutBody([{id: a, qty: 1}]);
    const r = await checkout(ctx, body);
    np.setDown(false);
    expect(r.status).toBe(503);
    expect(r.data.error).toBe('NP_UNAVAILABLE');
    expect((await db().query('select 1 from orders where idempotency_key = $1', [body.idempotency_key])).rowCount).toBe(0);
  });
});

describe('form validation messages (Ukrainian, per field)', () => {
  it('reports each invalid field', async () => {
    const r = await checkout(ctx, {
      ...checkoutBody([]),
      customer: {first_name: '', last_name: 'X1', phone: '123', email: 'nope'},
      consent: false,
    });
    expect(r.status).toBe(400);
    const fields = Object.fromEntries(r.data.details.fields.map((f: {path: string; message: string}) => [f.path, f.message]));
    expect(fields['customer.first_name']).toBe("Вкажіть ім'я");
    expect(fields['customer.phone']).toBe('Номер у форматі +380XXXXXXXXX');
    expect(fields['customer.email']).toBe('Перевірте email');
    expect(fields.consent).toBe('Потрібна ваша згода');
  });
});
