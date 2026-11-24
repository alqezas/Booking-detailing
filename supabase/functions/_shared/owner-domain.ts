/**
 * Owner assistant domain: READ-ONLY tool executors over the owner's own
 * bookings and payments (the calls run with the owner's JWT, so the database
 * checks membership), the system prompt and template answers.
 */
import type {AgentReply} from './agent.ts';
import {INTL, texts, type Lang} from './lang.ts';
import {routeOwner, type OwnerPeriod} from './router.ts';
import {money, norm} from './text.ts';
import {BEAUTY_OWNER_PROMPT, FREE_WORDS, freeSlotsAnswer, type FreeSummary} from './beauty-assistant.ts';

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
  upcoming?: number;
  upcoming_value?: number;
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
  /** Interface language of the studio; Russian when omitted. */
  lang?: Lang;
  stats: (period: OwnerPeriod, anchor: string) => Promise<OwnerStats>;
  bookings: (from: string, to: string) => Promise<OwnerBookingRow[]>;
  /** Beauty studios: free windows of the period (owner_free_slot_summary). */
  freeSlots?: (period: OwnerPeriod, anchor: string) => Promise<FreeSummary>;
  kind?: string;
};

const langOfSource = (src: OwnerSource): Lang => src.lang ?? 'ru';

const fmtTime = (iso: string, tz: string, lang: Lang) =>
  new Intl.DateTimeFormat(INTL[lang], {timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(iso));

export function periodText(s: Pick<OwnerStats, 'period' | 'from_date' | 'to_date'>, lang: Lang = 'ru'): string {
  const d = (iso: string) => new Intl.DateTimeFormat(INTL[lang], {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(`${iso}T12:00:00Z`));
  return s.period === 'day' ? d(s.from_date) : `${d(s.from_date)} – ${d(s.to_date)}`;
}

export async function ownerBookings(src: OwnerSource, period: OwnerPeriod, anchor: string) {
  const lang = langOfSource(src);
  const s = await src.stats(period, anchor);
  const rows = await src.bookings(s.from_at, s.to_at);
  return {
    period: periodText(s, lang),
    timezone: src.timezone,
    total_active: rows.filter(r => r.status !== 'cancelled').length,
    bookings: rows.slice(0, 40).map(r => ({
      when: fmtTime(r.start_at, src.timezone, lang),
      service: r.service_name,
      customer: r.customer_name,
      car: r.car,
      bay: r.resource_name,
      is_master: src.kind === 'beauty',
      status: texts(lang).status[r.status] ?? r.status,
      price: r.price,
      to_pay: r.status === 'cancelled' ? 0 : r.balance,
    })),
  };
}

export async function ownerStats(src: OwnerSource, period: OwnerPeriod, anchor: string) {
  const lang = langOfSource(src);
  const s = await src.stats(period, anchor);
  return {
    period: periodText(s, lang),
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
    ...(s.upcoming !== undefined ? {upcoming_confirmed: s.upcoming, upcoming_value_forecast: s.upcoming_value} : {}),
    note: texts(lang).netNote,
  };
}

export function ownerExecutor(src: OwnerSource) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const period = args.period as OwnerPeriod;
    const anchor = String(args.anchor_date);
    if (name === 'get_bookings') return ownerBookings(src, period, anchor);
    if (name === 'get_stats') return ownerStats(src, period, anchor);
    if (name === 'count_free_slots' && src.freeSlots) {
      const r = await src.freeSlots(period, anchor);
      return {...r, note: 'free_starts = start times with at least one free suitable master; at most 14 days ahead'};
    }
    return {error: texts(langOfSource(src)).toolUnavailable};
  };
}

export function ownerSystemPrompt(src: OwnerSource, today: string): string {
  const base = texts(langOfSource(src)).ownerPrompt(src.studioName, today, src.timezone);
  return src.kind === 'beauty' ? `${base}\n${BEAUTY_OWNER_PROMPT[langOfSource(src)]}` : base;
}

export async function ownerFallback(src: OwnerSource, text: string): Promise<AgentReply> {
  const lang = langOfSource(src);
  const say = texts(lang);
  const intent = routeOwner(text, src.timezone, undefined, lang);
  // Beauty: «Сколько свободных окон на этой неделе?»
  if (src.freeSlots && FREE_WORDS.test(norm(text, lang))) {
    const period: OwnerPeriod = intent.intent === 'clarify' ? 'week' : intent.period;
    const anchor = intent.intent === 'clarify' ? new Intl.DateTimeFormat('en-CA', {timeZone: src.timezone}).format(new Date()) : intent.anchor;
    const r = await src.freeSlots(period, anchor);
    const label = periodText({period, from_date: r.from_date, to_date: r.to_date}, lang);
    return {text: freeSlotsAnswer(r, label, lang, iso => fmtTime(iso, src.timezone, lang)), mode: 'fallback', tools: ['count_free_slots']};
  }
  if (intent.intent === 'clarify') return {text: intent.question, mode: 'fallback', tools: [], data: {options: intent.options ?? []}};
  if (intent.intent === 'bookings') {
    const r = await ownerBookings(src, intent.period, intent.anchor);
    if (!r.bookings.length) return {text: say.noBookings(r.period), mode: 'fallback', tools: ['get_bookings']};
    const lines = r.bookings.slice(0, 12).map(b => `${b.when} — ${b.service}, ${b.is_master ? `${b.customer} → ${b.bay}` : `${b.customer} (${b.car})`}, ${b.status}`);
    const more = r.bookings.length > 12 ? `\n${say.more(r.bookings.length - 12)}` : '';
    return {text: `${r.period}: ${r.total_active} ${say.bookingsCount(r.total_active)}.\n${lines.join('\n')}${more}`, mode: 'fallback', tools: ['get_bookings']};
  }
  const line = async (period: OwnerPeriod, label?: string) => {
    const s = await ownerStats(src, period, intent.anchor);
    const cars = say.cars(s.arrivals, s.completed, s.bookings);
    const extra = s.refunds ? say.cashExtra(money(s.money_received, src.currency, lang), money(s.refunds, src.currency, lang)) : null;
    const cash = say.cash(money(s.net_received, src.currency, lang), extra);
    const body = intent.focus === 'money' ? cash : intent.focus === 'cars' ? cars : `${cars}; ${cash}`;
    return `${label ?? s.period}: ${body}.`;
  };
  // No period in the question: answer for today and for this week.
  const answer = intent.explicit ? await line(intent.period) : `${await line('day', say.todayLabel)}
${await line('week', say.weekLabel)}`;
  return {text: answer.charAt(0).toUpperCase() + answer.slice(1), mode: 'fallback', tools: ['get_stats']};
}
