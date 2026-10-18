/**
 * Client assistant domain: tool executors over the PUBLIC studio data, the
 * system prompt and template answers for the no-model fallback. Texts follow
 * the studio's language (tenant.locale).
 */
import type {AgentReply} from './agent.ts';
import {langOf, texts, type Lang} from './lang.ts';
import {routeClient} from './router.ts';
import {duration, localDate, money, phone, when} from './text.ts';

export type PublicService = {id: string; name: string; category: string; price: number; price_from: boolean; duration_minutes: number; description: string};
export type PublicTenant = {
  slug: string;
  name: string;
  status: string;
  timezone: string;
  currency: string;
  locale?: string;
  phone: string;
  address: string;
  map_url: string | null;
  services: PublicService[];
  hours: {weekday: number; opens: string; closes: string}[];
  exceptions: {day: string; is_closed: boolean; note: string | null}[];
  booking: {horizon_days: number};
  faq?: {question: string; answer: string; keywords?: string[]}[];
};
export type AvailabilityDays = {timezone: string; days: {date: string; slots: {start_at: string; available: boolean}[]}[]; horizon_end: string};

export type ClientSource = {
  tenant: PublicTenant;
  availability: (serviceId: string, from: string, days: number) => Promise<AvailabilityDays>;
};

const langOfTenant = (t: PublicTenant): Lang => langOf(t.locale);

const mapSearch = (address: string, lang: Lang) =>
  lang === 'cs'
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;

export function studioInfo(t: PublicTenant) {
  const lang = langOfTenant(t);
  const say = texts(lang);
  return {
    name: t.name,
    address: t.address,
    phone: t.phone,
    map_url: t.map_url ?? mapSearch(t.address, lang),
    timezone: t.timezone,
    hours: [1, 2, 3, 4, 5, 6, 7].map(d => {
      const rows = t.hours.filter(h => h.weekday === d);
      return {day: say.weekdays[d], hours: rows.length ? rows.map(r => `${r.opens}–${r.closes}`).join(', ') : say.dayOff};
    }),
    days_off: t.exceptions.filter(e => e.is_closed).slice(0, 5).map(e => e.day),
  };
}

export const servicesList = (t: PublicTenant) =>
  t.services.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    price: s.price,
    price_from: s.price_from,
    duration: duration(s.duration_minutes, langOfTenant(t)),
  }));

export async function freeSlots(src: ClientSource, serviceId: string, dateFrom: string | null, limit = 4) {
  const t = src.tenant;
  const lang = langOfTenant(t);
  const say = texts(lang);
  const service = t.services.find(s => s.id === serviceId);
  if (!service) return {error: say.noService};
  const today = localDate(t.timezone);
  let from = dateFrom && dateFrom >= today ? dateFrom : today;
  const found: {start_at: string; label: string}[] = [];
  for (let page = 0; page < 3 && found.length < limit; page++) {
    const a = await src.availability(serviceId, from, 7);
    for (const d of a.days)
      for (const s of d.slots) if (s.available && found.length < limit) found.push({start_at: s.start_at, label: when(s.start_at, t.timezone, undefined, lang)});
    const last = a.days.at(-1)?.date;
    if (!last || last >= a.horizon_end.slice(0, 10)) break;
    const next = new Date(`${last}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    from = next.toISOString().slice(0, 10);
  }
  return {
    service: {id: service.id, name: service.name, duration: duration(service.duration_minutes, lang)},
    timezone: t.timezone,
    slots: found,
    note: found.length ? null : say.noSlotsNote,
  };
}

export function clientExecutor(src: ClientSource) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case 'get_studio_info':
        return studioInfo(src.tenant);
      case 'list_services':
        return servicesList(src.tenant);
      case 'find_free_slots':
        return freeSlots(src, String(args.service_id), (args.date_from as string | null) ?? null, (args.limit as number | null) ?? 4);
      default:
        return {error: texts(langOfTenant(src.tenant)).toolUnavailable};
    }
  };
}

export function clientSystemPrompt(t: PublicTenant, today: string): string {
  const say = texts(langOfTenant(t));
  const faq = (t.faq ?? []).map(f => `— ${f.question}\n${f.answer}`).join('\n\n');
  return say.clientPrompt(t.name, today, t.timezone) + (faq ? `\n\n${say.faqIntro}\n${faq}` : '');
}

/** Template answer from the deterministic router: correct, if less fluent. */
export async function clientFallback(src: ClientSource, text: string): Promise<AgentReply> {
  const t = src.tenant;
  const lang = langOfTenant(t);
  const say = texts(lang);
  const intent = routeClient(text, t.services, t.timezone, undefined, lang, t.faq ?? []);
  const cur = t.currency;
  switch (intent.intent) {
    case 'location': {
      const i = studioInfo(t);
      return {text: say.location(i.address, i.map_url, phone(i.phone)), mode: 'fallback', tools: ['get_studio_info'], data: {map_url: i.map_url}};
    }
    case 'hours': {
      const i = studioInfo(t);
      return {text: say.hours(i.hours.map(h => `${h.day} ${h.hours}`).join('; ')), mode: 'fallback', tools: ['get_studio_info']};
    }
    case 'contacts':
      return {text: say.contacts(phone(t.phone), t.address), mode: 'fallback', tools: ['get_studio_info']};
    case 'services':
    case 'price': {
      const ids = intent.intent === 'price' ? intent.serviceIds : t.services.map(s => s.id);
      const list = t.services.filter(s => ids.includes(s.id)).slice(0, 8);
      const price = (s: PublicService) => (s.price === 0 && !s.price_from ? say.onRequest : `${s.price_from ? say.from : ''}${money(s.price, cur, lang)}`);
      const lines = list.map(s => `${s.name} — ${price(s)}, ${duration(s.duration_minutes, lang)}`);
      return {text: lines.length === 1 ? `${lines[0]}.` : `${say.prices}\n${lines.join('\n')}`, mode: 'fallback', tools: ['list_services']};
    }
    case 'nearest_slot': {
      const r = await freeSlots(src, intent.serviceId, intent.dateFrom, 3);
      if ('error' in r) return {text: r.error as string, mode: 'fallback', tools: ['find_free_slots']};
      if (!r.slots.length) return {text: say.noSlots(r.service.name, phone(t.phone)), mode: 'fallback', tools: ['find_free_slots']};
      return {
        text: say.slots(r.service.name, r.slots.map(s => s.label).join(', ')),
        mode: 'fallback',
        tools: ['find_free_slots'],
        data: {service_id: r.service.id, slots: r.slots},
      };
    }
    case 'faq':
      return {text: t.faq![intent.index]!.answer, mode: 'fallback', tools: []};
    case 'clarify':
      return {text: intent.question, mode: 'fallback', tools: [], data: {options: intent.options ?? []}};
  }
}
