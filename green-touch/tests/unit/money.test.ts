import {describe, expect, it} from 'vitest';
import {moneyStats, periodBounds, periodUtc, shiftAnchor, topProducts, type MoneyOrder} from '../../src/lib/money.ts';

const order = (o: Partial<MoneyOrder> & {id: string}): MoneyOrder => ({
  number: 1,
  first_name: 'Олена',
  last_name: 'Коваль',
  total_kop: 100000,
  payment_method: 'full_online',
  payment_status: 'unpaid',
  paid_at: null,
  prepay_kop: 0,
  prepay_received_at: null,
  fulfillment_status: 'new',
  created_at: '2026-11-17T10:00:00Z',
  ...o,
});

describe('money periods (Kyiv calendar)', () => {
  it('weeks run Monday to Sunday, months to their last day', () => {
    expect(periodBounds('week', '2026-11-21')).toEqual({from: '2026-11-16', to: '2026-11-22'});
    expect(periodBounds('week', '2026-11-16')).toEqual({from: '2026-11-16', to: '2026-11-22'});
    expect(periodBounds('month', '2026-02-10')).toEqual({from: '2026-02-01', to: '2026-02-28'});
    expect(periodBounds('month', '2026-12-31')).toEqual({from: '2026-12-01', to: '2026-12-31'});
  });
  it('shifts by one period, across year ends', () => {
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftAnchor('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftAnchor('week', '2026-11-21', -1)).toBe('2026-11-14');
  });
  it('UTC bounds use the Kyiv offset', () => {
    expect(periodUtc({from: '2026-11-21', to: '2026-11-21'})).toEqual({fromUtc: '2026-11-20T22:00:00.000Z', toUtc: '2026-11-21T22:00:00.000Z'});
  });
});

describe('moneyStats', () => {
  const {fromUtc, toUtc} = periodUtc(periodBounds('week', '2026-11-21'));

  it('counts online payments, prepayments, cash on delivery and refunds by when the money moved', () => {
    const orders = [
      order({id: 'a', payment_status: 'paid', paid_at: '2026-11-18T09:00:00Z', fulfillment_status: 'shipped'}),
      order({id: 'b', payment_method: 'prepay_manual', total_kop: 90000, prepay_kop: 15000, prepay_received_at: '2026-11-17T12:00:00Z', fulfillment_status: 'delivered'}),
      order({id: 'c', payment_method: 'prepay_manual', total_kop: 50000, prepay_kop: 15000, prepay_received_at: '2026-11-10T12:00:00Z', fulfillment_status: 'shipped', created_at: '2026-11-09T10:00:00Z'}),
      order({id: 'd', payment_status: 'reversed', paid_at: '2026-11-05T09:00:00Z', created_at: '2026-11-05T08:00:00Z'}),
      order({id: 'e', payment_status: 'awaiting', total_kop: 40000}),
      order({id: 'f', payment_status: 'expired', total_kop: 70000}),
      order({id: 'g', fulfillment_status: 'cancelled', total_kop: 30000}),
    ];
    const s = moneyStats(
      orders,
      [
        {order_id: 'a', to: 'shipped', at: '2026-11-19T10:00:00Z'},
        {order_id: 'b', to: 'delivered', at: '2026-11-20T10:00:00Z'},
        {order_id: 'g', to: 'cancelled', at: '2026-11-18T10:00:00Z'},
        {order_id: 'c', to: 'shipped', at: '2026-11-11T10:00:00Z'}, // last week
      ],
      [{order_id: 'd', amount_kop: 100000, at: '2026-11-19T08:00:00Z'}],
      fromUtc,
      toUtc,
    );
    expect(s.online_kop).toBe(100000);
    expect(s.prepay_kop).toBe(15000);
    expect(s.cod_kop).toBe(75000);
    expect(s.received_kop).toBe(190000);
    expect(s.refunded_kop).toBe(100000);
    expect(s.net_kop).toBe(90000);
    expect(s.paid).toBe(2);
    expect([s.shipped, s.delivered, s.cancelled]).toEqual([1, 1, 1]);
    expect(s.created).toBe(5); // a, b, e, f, g
    expect(s.avg_check_kop).toBe(Math.round((100000 + 90000 + 40000 + 70000) / 4));
    // waiting: e (online, still payable); f expired and g cancelled are not expected
    expect([s.awaiting_payment, s.awaiting_payment_kop]).toEqual([1, 40000]);
    // c: prepay made, parcel not picked up yet → 350 грн still to come
    expect([s.cod_pending, s.cod_pending_kop]).toEqual([1, 35000]);
    expect(s.entries.map(e => e.kind)).toEqual(['cod', 'refund', 'online', 'prepay']);
    expect(s.paid_order_ids.sort()).toEqual(['a', 'b']);
  });

  it('no cash on delivery if the order was moved back from «Отримано»', () => {
    const o = order({id: 'b', payment_method: 'prepay_manual', total_kop: 90000, prepay_kop: 15000, prepay_received_at: '2026-11-01T12:00:00Z', fulfillment_status: 'shipped', created_at: '2026-11-01T10:00:00Z'});
    const s = moneyStats([o], [{order_id: 'b', to: 'delivered', at: '2026-11-20T10:00:00Z'}], [], fromUtc, toUtc);
    expect(s.cod_kop).toBe(0);
    expect(s.cod_pending_kop).toBe(75000);
  });
});

describe('topProducts', () => {
  it('groups by name and volume, sorted by revenue', () => {
    const t = topProducts([
      {order_id: '1', name: 'Крем', volume: '50 мл', qty: 1, line_total_kop: 110000},
      {order_id: '2', name: 'Крем', volume: '50 мл', qty: 2, line_total_kop: 220000},
      {order_id: '2', name: 'Тонік', volume: null, qty: 1, line_total_kop: 40000},
    ]);
    expect(t).toEqual([
      {name: 'Крем, 50 мл', qty: 3, total_kop: 330000},
      {name: 'Тонік', qty: 1, total_kop: 40000},
    ]);
  });
});
