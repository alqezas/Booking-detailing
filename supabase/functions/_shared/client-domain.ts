/**
 * Client assistant domain: tool executors over the PUBLIC studio data, the
 * system prompt and template answers for the no-model fallback.
 */
import type {AgentReply} from './agent.ts';
import {routeClient} from './router.ts';
import {duration, localDate, money, when} from './text.ts';

export type PublicService = {id: string; name: string; category: string; price: number; price_from: boolean; duration_minutes: number; description: string};
export type PublicTenant = {
  slug: string;
  name: string;
  status: string;
  timezone: string;
  currency: string;
  phone: string;
  address: string;
  map_url: string | null;
  services: PublicService[];
  hours: {weekday: number; opens: string; closes: string}[];
  exceptions: {day: string; is_closed: boolean; note: string | null}[];
  booking: {horizon_days: number};
};
export type AvailabilityDays = {timezone: string; days: {date: string; slots: {start_at: string; available: boolean}[]}[]; horizon_end: string};

export type ClientSource = {
  tenant: PublicTenant;
  availability: (serviceId: string, from: string, days: number) => Promise<AvailabilityDays>;
};

const WD = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function studioInfo(t: PublicTenant) {
  return {
    name: t.name,
    address: t.address,
    phone: t.phone,
    map_url: t.map_url ?? `https://yandex.ru/maps/?text=${encodeURIComponent(t.address)}`,
    timezone: t.timezone,
    hours: [1, 2, 3, 4, 5, 6, 7].map(d => {
      const rows = t.hours.filter(h => h.weekday === d);
      return {day: WD[d], hours: rows.length ? rows.map(r => `${r.opens}–${r.closes}`).join(', ') : 'выходной'};
    }),
    days_off: t.exceptions.filter(e => e.is_closed).slice(0, 5).map(e => e.day),
  };
}

export const servicesList = (t: PublicTenant) =>
  t.services.map(s => ({id: s.id, name: s.name, category: s.category, price: s.price, price_from: s.price_from, duration: duration(s.duration_minutes)}));

export async function freeSlots(src: ClientSource, serviceId: string, dateFrom: string | null, limit = 4) {
  const t = src.tenant;
  const service = t.services.find(s => s.id === serviceId);
  if (!service) return {error: 'Нет такой услуги. Возьми service_id из list_services.'};
  const today = localDate(t.timezone);
  let from = dateFrom && dateFrom >= today ? dateFrom : today;
  const found: {start_at: string; label: string}[] = [];
  for (let page = 0; page < 3 && found.length < limit; page++) {
    const a = await src.availability(serviceId, from, 7);
    for (const d of a.days) for (const s of d.slots) if (s.available && found.length < limit) found.push({start_at: s.start_at, label: when(s.start_at, t.timezone)});
    const last = a.days.at(-1)?.date;
    if (!last || last >= a.horizon_end.slice(0, 10)) break;
    const next = new Date(`${last}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    from = next.toISOString().slice(0, 10);
  }
  return {
    service: {id: service.id, name: service.name, duration: duration(service.duration_minutes)},
    timezone: t.timezone,
    slots: found,
    note: found.length ? null : 'Свободного времени в ближайшие три недели нет',
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
        return {error: 'Инструмент недоступен'};
    }
  };
}

export function clientSystemPrompt(t: PublicTenant, today: string): string {
  return [
    `Ты — помощник онлайн-записи студии «${t.name}». Сегодня ${today}, часовой пояс студии ${t.timezone}.`,
    'Отвечай по-русски, коротко и дружелюбно, 1–4 предложения.',
    'Отвечай ТОЛЬКО по данным, полученным из инструментов. Не придумывай цены, время, адреса и скидки.',
    'Свободное время ищи только через find_free_slots. Если неясно, какая услуга нужна, задай один уточняющий вопрос.',
    'Не обсуждай других клиентов и чужие записи — таких данных у тебя нет.',
    'Чтобы записаться, предложи нажать «Записаться» и выбрать время. Сам ты записи не создаёшь и не отменяешь.',
  ].join('\n');
}

/** Template answer from the deterministic router: correct, if less fluent. */
export async function clientFallback(src: ClientSource, text: string): Promise<AgentReply> {
  const t = src.tenant;
  const intent = routeClient(text, t.services, t.timezone);
  const cur = t.currency;
  switch (intent.intent) {
    case 'location': {
      const i = studioInfo(t);
      return {text: `Мы находимся по адресу: ${i.address}. Маршрут: ${i.map_url}. Телефон: ${i.phone}.`, mode: 'fallback', tools: ['get_studio_info'], data: {map_url: i.map_url}};
    }
    case 'hours': {
      const i = studioInfo(t);
      return {text: `Часы работы: ${i.hours.map(h => `${h.day} ${h.hours}`).join('; ')}.`, mode: 'fallback', tools: ['get_studio_info']};
    }
    case 'contacts':
      return {text: `Телефон студии: ${t.phone}. Адрес: ${t.address}.`, mode: 'fallback', tools: ['get_studio_info']};
    case 'services':
    case 'price': {
      const ids = intent.intent === 'price' ? intent.serviceIds : t.services.map(s => s.id);
      const list = t.services.filter(s => ids.includes(s.id)).slice(0, 8);
      const lines = list.map(s => `${s.name} — ${s.price_from ? 'от ' : ''}${money(s.price, cur)}, ${duration(s.duration_minutes)}`);
      return {text: lines.length === 1 ? `${lines[0]}.` : `Цены:\n${lines.join('\n')}`, mode: 'fallback', tools: ['list_services']};
    }
    case 'nearest_slot': {
      const r = await freeSlots(src, intent.serviceId, intent.dateFrom, 3);
      if ('error' in r) return {text: r.error as string, mode: 'fallback', tools: ['find_free_slots']};
      if (!r.slots.length) return {text: `На «${r.service.name}» в ближайшие три недели свободного времени нет. Позвоните: ${t.phone}.`, mode: 'fallback', tools: ['find_free_slots']};
      return {
        text: `Ближайшее свободное время на «${r.service.name}»: ${r.slots.map(s => s.label).join(', ')}. Нажмите «Записаться», чтобы выбрать его.`,
        mode: 'fallback',
        tools: ['find_free_slots'],
        data: {service_id: r.service.id, slots: r.slots},
      };
    }
    case 'clarify':
      return {text: intent.question, mode: 'fallback', tools: [], data: {options: intent.options ?? []}};
  }
}
