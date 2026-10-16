/**
 * Owner assistant domain: READ-ONLY tool executors over the owner's own
 * bookings and payments (the calls run with the owner's JWT, so the database
 * checks membership), the system prompt and template answers.
 */
import type {AgentReply} from './agent.ts';
import {routeOwner, type OwnerPeriod} from './router.ts';
import {money, plural} from './text.ts';

export type OwnerStats = {
  period: OwnerPeriod;
  from_date: string;
  to_date: string;
  from_at: string;
  to_at: string;
  bookings: number;
  cancelled: number;
  no_show: number;
  arrivals: number;
  completed: number;
  received: number;
  refunded: number;
  net_received: number;
  expected_value: number;
};
export type OwnerBookingRow = {
  start_at: string;
  service_name: string;
  customer_name: string;
  car: string;
  status: string;
  price: number;
  balance: number;
  resource_name: string;
};

export type OwnerSource = {
  timezone: string;
  currency: string;
  studioName: string;
  stats: (period: OwnerPeriod, anchor: string) => Promise<OwnerStats>;
  bookings: (from: string, to: string) => Promise<OwnerBookingRow[]>;
};

const STATUS: Record<string, string> = {confirmed: 'ожидаем', arrived: 'принята', ready: 'готова', cancelled: 'отменена', no_show: 'не приехал'};

const fmtTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', {timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(iso));

export function periodText(s: Pick<OwnerStats, 'period' | 'from_date' | 'to_date'>): string {
  const d = (iso: string) => new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(`${iso}T12:00:00Z`));
  return s.period === 'day' ? d(s.from_date) : `${d(s.from_date)} – ${d(s.to_date)}`;
}

export async function ownerBookings(src: OwnerSource, period: OwnerPeriod, anchor: string) {
  const s = await src.stats(period, anchor);
  const rows = await src.bookings(s.from_at, s.to_at);
  return {
    period: periodText(s),
    timezone: src.timezone,
    total_active: rows.filter(r => r.status !== 'cancelled').length,
    bookings: rows.slice(0, 40).map(r => ({
      when: fmtTime(r.start_at, src.timezone),
      service: r.service_name,
      customer: r.customer_name,
      car: r.car,
      bay: r.resource_name,
      status: STATUS[r.status] ?? r.status,
      price: r.price,
      to_pay: r.status === 'cancelled' ? 0 : r.balance,
    })),
  };
}

export async function ownerStats(src: OwnerSource, period: OwnerPeriod, anchor: string) {
  const s = await src.stats(period, anchor);
  return {
    period: periodText(s),
    currency: src.currency,
    arrivals: s.arrivals,
    completed: s.completed,
    bookings: s.bookings,
    cancelled: s.cancelled,
    no_show: s.no_show,
    money_received: s.received,
    refunds: s.refunded,
    net_received: s.net_received,
    expected_value_forecast: s.expected_value,
    note: 'net_received — реально полученные деньги. expected_value_forecast — прогноз по ценам записей, не выручка.',
  };
}

export function ownerExecutor(src: OwnerSource) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const period = args.period as OwnerPeriod;
    const anchor = String(args.anchor_date);
    if (name === 'get_bookings') return ownerBookings(src, period, anchor);
    if (name === 'get_stats') return ownerStats(src, period, anchor);
    return {error: 'Инструмент недоступен'};
  };
}

export function ownerSystemPrompt(src: OwnerSource, today: string): string {
  return [
    `Ты — помощник владельца студии «${src.studioName}». Сегодня ${today}, часовой пояс ${src.timezone}.`,
    'Отвечай по-русски, кратко, цифрами. Данные бери ТОЛЬКО из инструментов get_bookings и get_stats.',
    'Неделя — с понедельника по воскресенье. «Получено» — это net_received; ожидаемая стоимость — прогноз, не называй её выручкой.',
    'Ты только читаешь данные: не создаёшь, не переносишь и не отменяешь записи и не вносишь оплаты. Если просят изменить — объясни, где это сделать в кабинете.',
    'Если период неясен, уточни.',
  ].join('\n');
}

export async function ownerFallback(src: OwnerSource, text: string): Promise<AgentReply> {
  const intent = routeOwner(text, src.timezone);
  if (intent.intent === 'clarify') return {text: intent.question, mode: 'fallback', tools: [], data: {options: intent.options ?? []}};
  if (intent.intent === 'bookings') {
    const r = await ownerBookings(src, intent.period, intent.anchor);
    if (!r.bookings.length) return {text: `На ${r.period} записей нет.`, mode: 'fallback', tools: ['get_bookings']};
    const lines = r.bookings.slice(0, 12).map(b => `${b.when} — ${b.service}, ${b.customer} (${b.car}), ${b.status}`);
    const more = r.bookings.length > 12 ? `\n…и ещё ${r.bookings.length - 12}` : '';
    return {text: `${r.period}: ${r.total_active} ${plural(r.total_active, 'запись', 'записи', 'записей')}.\n${lines.join('\n')}${more}`, mode: 'fallback', tools: ['get_bookings']};
  }
  const line = async (period: OwnerPeriod, label?: string) => {
    const s = await ownerStats(src, period, intent.anchor);
    const cars = `заездов ${s.arrivals}, работ завершено ${s.completed}, записей ${s.bookings}`;
    const cash = `получено ${money(s.net_received, src.currency)}${s.refunds ? ` (оплаты ${money(s.money_received, src.currency)}, возвраты ${money(s.refunds, src.currency)})` : ''}`;
    const body = intent.focus === 'money' ? cash : intent.focus === 'cars' ? cars : `${cars}; ${cash}`;
    return `${label ?? s.period}: ${body}.`;
  };
  // No period in the question: answer for today and for this week.
  const answer = intent.explicit ? await line(intent.period) : `${await line('day', 'Сегодня')}
${await line('week', 'За эту неделю')}`;
  return {text: answer.charAt(0).toUpperCase() + answer.slice(1), mode: 'fallback', tools: ['get_stats']};
}
