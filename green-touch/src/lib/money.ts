/**
 * «Гроші» in the admin: pure calculations over orders the owner can already read.
 * Periods are Kyiv calendar days; the database stores UTC.
 */
import {formatInTimeZone} from 'date-fns-tz';
import {uk} from 'date-fns/locale';
import {addDays, kyivDayStartUtc} from './format.ts';

export type Period = 'day' | 'week' | 'month';

/** Inclusive Kyiv dates of the period that contains `anchor` (weeks start on Monday). */
export function periodBounds(period: Period, anchor: string): {from: string; to: string} {
  if (period === 'day') return {from: anchor, to: anchor};
  if (period === 'week') {
    const dow = (new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(anchor, -dow);
    return {from, to: addDays(from, 6)};
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const [y, m] = from.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return {from, to: addDays(next, -1)};
}

/** Moves the anchor one period back or forward. */
export function shiftAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, 7 * dir);
  const {from, to} = periodBounds('month', anchor);
  return dir === 1 ? addDays(to, 1) : periodBounds('month', addDays(from, -1)).from;
}

/** UTC half-open range [fromUtc, toUtc) of a period. */
export const periodUtc = (b: {from: string; to: string}) => ({fromUtc: kyivDayStartUtc(b.from), toUtc: kyivDayStartUtc(addDays(b.to, 1))});

const fmt = (day: string, pattern: string) => formatInTimeZone(`${day}T12:00:00Z`, 'UTC', pattern, {locale: uk});

export function periodLabel(period: Period, b: {from: string; to: string}, today: string): string {
  if (period === 'day') {
    const prefix = b.from === today ? 'Сьогодні, ' : b.from === addDays(today, -1) ? 'Вчора, ' : '';
    return prefix + fmt(b.from, 'd MMMM yyyy');
  }
  if (period === 'month') {
    const m = formatInTimeZone(`${b.from}T12:00:00Z`, 'UTC', 'LLLL yyyy', {locale: uk});
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return `${fmt(b.from, 'd MMM')} – ${fmt(b.to, 'd MMM yyyy')}`;
}

export type MoneyOrder = {
  id: string;
  number: number;
  first_name: string;
  last_name: string;
  total_kop: number;
  payment_method: 'full_online' | 'prepay_manual';
  payment_status: string;
  paid_at: string | null;
  prepay_kop: number;
  prepay_received_at: string | null;
  fulfillment_status: string;
  created_at: string;
};
/** owner.fulfillment timeline rows: when an order became shipped / delivered / cancelled. */
export type StatusChange = {order_id: string; to: string; at: string};
/** payment_attempts that the bank reversed (refunds). */
export type Reversal = {order_id: string; amount_kop: number; at: string};

export type MoneyEntry = {
  key: string;
  kind: 'online' | 'prepay' | 'cod' | 'refund';
  amount_kop: number;
  at: string;
  order: Pick<MoneyOrder, 'id' | 'number' | 'first_name' | 'last_name'>;
};

export type MoneyStats = {
  received_kop: number;
  online_kop: number;
  prepay_kop: number;
  cod_kop: number;
  refunded_kop: number;
  net_kop: number;
  created: number;
  paid: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  avg_check_kop: number;
  awaiting_payment_kop: number;
  awaiting_payment: number;
  cod_pending_kop: number;
  cod_pending: number;
  entries: MoneyEntry[];
  /** orders whose money arrived in the period (for the product breakdown) */
  paid_order_ids: string[];
};

const inRange = (iso: string | null, fromUtc: string, toUtc: string) => !!iso && iso >= fromUtc && iso < toUtc;
const ts = (iso: string) => new Date(iso).toISOString();

/**
 * What came in during [fromUtc, toUtc):
 * - online: full monobank payment (paid_at);
 * - prepay: the 150 грн the owner marked as received;
 * - cod: the rest of a prepay order, counted when the buyer picked it up («Отримано»);
 * - refund: payments the bank reversed.
 * Waiting amounts (not yet paid, cash on delivery still to come) are for all open orders, not the period.
 */
export function moneyStats(orders: MoneyOrder[], changes: StatusChange[], reversals: Reversal[], fromUtc: string, toUtc: string): MoneyStats {
  const byId = new Map(orders.map(o => [o.id, o]));
  const ref = (o: MoneyOrder) => ({id: o.id, number: o.number, first_name: o.first_name, last_name: o.last_name});
  const entries: MoneyEntry[] = [];
  const paidIds = new Set<string>();

  for (const o of orders) {
    if (o.payment_method === 'full_online' && o.paid_at && inRange(ts(o.paid_at), fromUtc, toUtc)) {
      entries.push({key: `online:${o.id}`, kind: 'online', amount_kop: o.total_kop, at: o.paid_at, order: ref(o)});
      paidIds.add(o.id);
    }
    if (o.payment_method === 'prepay_manual' && o.prepay_received_at && inRange(ts(o.prepay_received_at), fromUtc, toUtc)) {
      entries.push({key: `prepay:${o.id}`, kind: 'prepay', amount_kop: o.prepay_kop, at: o.prepay_received_at, order: ref(o)});
      paidIds.add(o.id);
    }
  }
  // last status change per order and target inside the period
  const lastTo = new Map<string, StatusChange>();
  for (const c of changes) {
    if (!inRange(ts(c.at), fromUtc, toUtc)) continue;
    const k = `${c.order_id}:${c.to}`;
    const prev = lastTo.get(k);
    if (!prev || prev.at < c.at) lastTo.set(k, c);
  }
  const count = (to: string) => [...lastTo.values()].filter(c => c.to === to).length;
  for (const c of lastTo.values()) {
    const o = byId.get(c.order_id);
    // cash on delivery only if the order is still delivered (not moved back) and the prepayment was made
    if (c.to !== 'delivered' || !o || o.payment_method !== 'prepay_manual' || !o.prepay_received_at || o.fulfillment_status !== 'delivered') continue;
    entries.push({key: `cod:${o.id}`, kind: 'cod', amount_kop: o.total_kop - o.prepay_kop, at: c.at, order: ref(o)});
  }
  for (const r of reversals) {
    const o = byId.get(r.order_id);
    if (!o || !inRange(ts(r.at), fromUtc, toUtc)) continue;
    entries.push({key: `refund:${r.order_id}:${r.at}`, kind: 'refund', amount_kop: r.amount_kop, at: r.at, order: ref(o)});
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const sum = (k: MoneyEntry['kind']) => entries.filter(e => e.kind === k).reduce((s, e) => s + e.amount_kop, 0);
  const online = sum('online');
  const prepay = sum('prepay');
  const cod = sum('cod');
  const refunded = sum('refund');
  const received = online + prepay + cod;

  const created = orders.filter(o => inRange(ts(o.created_at), fromUtc, toUtc));
  const createdLive = created.filter(o => o.fulfillment_status !== 'cancelled');

  const open = orders.filter(o => o.fulfillment_status !== 'cancelled');
  const unpaid = open.filter(o => (o.payment_method === 'full_online' ? o.payment_status !== 'paid' && o.payment_status !== 'reversed' : !o.prepay_received_at));
  const codPending = open.filter(o => o.payment_method === 'prepay_manual' && o.prepay_received_at && o.fulfillment_status !== 'delivered');

  return {
    received_kop: received,
    online_kop: online,
    prepay_kop: prepay,
    cod_kop: cod,
    refunded_kop: refunded,
    net_kop: received - refunded,
    created: created.length,
    paid: paidIds.size,
    shipped: count('shipped'),
    delivered: count('delivered'),
    cancelled: count('cancelled'),
    avg_check_kop: createdLive.length ? Math.round(createdLive.reduce((s, o) => s + o.total_kop, 0) / createdLive.length) : 0,
    // expired online orders are no longer expected
    awaiting_payment_kop: unpaid.filter(o => o.payment_status !== 'expired' && o.payment_status !== 'failed').reduce((s, o) => s + (o.payment_method === 'full_online' ? o.total_kop : o.prepay_kop), 0),
    awaiting_payment: unpaid.filter(o => o.payment_status !== 'expired' && o.payment_status !== 'failed').length,
    cod_pending_kop: codPending.reduce((s, o) => s + o.total_kop - o.prepay_kop, 0),
    cod_pending: codPending.length,
    entries,
    paid_order_ids: [...paidIds],
  };
}

export type SoldLine = {order_id: string; name: string; volume: string | null; qty: number; line_total_kop: number};
export type TopProduct = {name: string; qty: number; total_kop: number};

/** Products in the orders paid during the period, by revenue. */
export function topProducts(lines: SoldLine[], limit = 10): TopProduct[] {
  const m = new Map<string, TopProduct>();
  for (const l of lines) {
    const name = l.volume ? `${l.name}, ${l.volume}` : l.name;
    const t = m.get(name) ?? {name, qty: 0, total_kop: 0};
    t.qty += l.qty;
    t.total_kop += l.line_total_kop;
    m.set(name, t);
  }
  return [...m.values()].sort((a, b) => b.total_kop - a.total_kop || b.qty - a.qty).slice(0, limit);
}

