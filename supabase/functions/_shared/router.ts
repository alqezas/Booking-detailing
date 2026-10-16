/**
 * Deterministic intent router. Used three ways:
 *  1. as the fallback when the model is unavailable or over budget,
 *  2. to validate / repair a model's JSON intent,
 *  3. in tests, as the reference behaviour.
 * It never touches data: it only decides WHICH allowed tool to run with
 * WHICH arguments, or which clarifying question to ask.
 */
import {localDate, norm, stem, words} from './text.ts';

export type ServiceRef = {id: string; name: string; category?: string};

export type ClientIntent =
  | {intent: 'nearest_slot'; serviceId: string; dateFrom: string | null}
  | {intent: 'price'; serviceIds: string[]}
  | {intent: 'location'}
  | {intent: 'hours'}
  | {intent: 'services'}
  | {intent: 'contacts'}
  | {intent: 'clarify'; question: string; options?: string[]};

export type OwnerPeriod = 'day' | 'week' | 'month';
export type OwnerIntent =
  | {intent: 'bookings'; period: OwnerPeriod; anchor: string}
  | {intent: 'stats'; period: OwnerPeriod; anchor: string; focus: 'cars' | 'money' | 'all'; explicit: boolean}
  | {intent: 'clarify'; question: string; options?: string[]};

const has = (text: string, re: RegExp) => re.test(text);

const WEEKDAY_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const isoWeekday = (tz: string, now = new Date()) =>
  WEEKDAY_EN.indexOf(new Intl.DateTimeFormat('en-US', {timeZone: tz, weekday: 'short'}).format(now)) + 1;

/** YYYY-MM-DD ± days (calendar arithmetic, no time zone involved). */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
/** «керамику» ~ «керамическое», «мойку» ~ «мойка»: long shared prefix of the stems. */
const sameStem = (a: string, b: string) => commonPrefix(a, b) >= Math.min(5, a.length, b.length);

/** Services mentioned in the text, best match first. */
export function matchServices(text: string, services: ServiceRef[]): ServiceRef[] {
  const w = words(text).map(stem);
  const scored = services
    .map(s => {
      const sw = words(`${s.name} ${s.category ?? ''}`).map(stem);
      const score = sw.filter(x => w.some(y => sameStem(x, y))).length;
      return {s, score};
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const best = scored[0]!.score;
  return scored.filter(x => x.score === best).map(x => x.s);
}

const WEEKDAYS: [RegExp, number][] = [
  [/понедельник/, 1],
  [/вторник/, 2],
  [/сред[уа]/, 3],
  [/четверг/, 4],
  [/пятниц/, 5],
  [/суббот/, 6],
  [/воскресень/, 7],
];

/** «завтра», «послезавтра», «в субботу», «на выходных», «18 октября» → local date. */
export function parseDate(text: string, tz: string, now = new Date()): string | null {
  const t = norm(text);
  if (/послезавтра/.test(t)) return localDate(tz, 2, now);
  if (/завтра/.test(t)) return localDate(tz, 1, now);
  if (/сегодня/.test(t)) return localDate(tz, 0, now);
  const todayIso = isoWeekday(tz, now);
  if (/выходн/.test(t)) return localDate(tz, (6 - todayIso + 7) % 7, now);
  for (const [re, iso] of WEEKDAYS) {
    if (re.test(t)) return localDate(tz, (iso - todayIso + 7) % 7 || 7, now);
  }
  const months = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  const m = t.match(/(\d{1,2})\s+([а-я]+)/);
  if (m) {
    const mi = months.findIndex(p => m[2]!.startsWith(p));
    if (mi >= 0) {
      const year = Number(localDate(tz, 0, now).slice(0, 4));
      const candidate = `${year}-${String(mi + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
      return candidate < localDate(tz, 0, now) ? `${year + 1}${candidate.slice(4)}` : candidate;
    }
  }
  return null;
}

export function routeClient(text: string, services: ServiceRef[], tz: string, now = new Date()): ClientIntent {
  const t = norm(text);
  const mentioned = matchServices(t, services);
  const names = services.map(s => s.name);

  if (has(t, /(как|где).{0,20}(найти|добрат|доехат|проехат|находит)|адрес|маршрут|на карте/)) return {intent: 'location'};
  if (has(t, /(сколько|почем|почём).{0,15}(стоит|стоят|будет)|цен[аыу]|стоимост|прайс|по деньгам/)) {
    if (mentioned.length) return {intent: 'price', serviceIds: mentioned.map(s => s.id)};
    return {intent: 'price', serviceIds: services.map(s => s.id)};
  }
  if (has(t, /ближайш|свободн|окн[оа]|когда.{0,15}(можно|получится|запис|приехат)|есть.{0,10}(время|место)|записат|запиши/)) {
    if (mentioned.length === 1) return {intent: 'nearest_slot', serviceId: mentioned[0]!.id, dateFrom: parseDate(t, tz, now)};
    if (mentioned.length > 1) {
      return {intent: 'clarify', question: 'Уточните, пожалуйста, какая именно услуга нужна?', options: mentioned.map(s => s.name)};
    }
    if (services.length === 1) return {intent: 'nearest_slot', serviceId: services[0]!.id, dateFrom: parseDate(t, tz, now)};
    return {intent: 'clarify', question: 'Подскажите, на какую услугу ищете время? От неё зависит длительность.', options: names.slice(0, 6)};
  }
  if (has(t, /график|час[ыа] работ|режим|во сколько|до скольки|открыт|работаете/)) return {intent: 'hours'};
  if (has(t, /какие услуги|что.{0,10}(делаете|умеете|есть)|список|услуги/)) return {intent: 'services'};
  if (has(t, /телефон|позвонить|связат|whatsapp|телеграм|telegram/)) return {intent: 'contacts'};
  if (mentioned.length) return {intent: 'price', serviceIds: mentioned.map(s => s.id)};
  return {
    intent: 'clarify',
    question: 'Я помогу со свободным временем, ценами и тем, как нас найти. Что подсказать?',
    options: ['Когда ближайшее окно?', 'Сколько стоит полировка?', 'Как найти студию?'],
  };
}

export function routeOwner(text: string, tz: string, now = new Date()): OwnerIntent {
  const t = norm(text);
  let period: OwnerPeriod = 'day';
  let anchor = localDate(tz, 0, now);
  const explicit = /недел|месяц|вчера|сегодня|завтра|понедельник|вторник|сред[уа]|четверг|пятниц|суббот|воскресень|\d{1,2}\s+[а-я]+/.test(t);
  if (/прошл\S* недел/.test(t)) {
    period = 'week';
    anchor = localDate(tz, -7, now);
  } else if (/недел/.test(t)) period = 'week';
  else if (/прошл\S* месяц/.test(t)) {
    period = 'month';
    anchor = shiftDate(`${localDate(tz, 0, now).slice(0, 7)}-01`, -1);
  } else if (/месяц/.test(t)) period = 'month';
  else if (/вчера/.test(t)) anchor = localDate(tz, -1, now);
  else if (/завтра/.test(t)) anchor = localDate(tz, 1, now);
  else {
    const d = parseDate(t, tz, now);
    if (d) anchor = d;
  }

  const money = has(t, /денег|деньги|выручк|получен|заработ|оплат|касс|сколько.{0,10}(рубл|₽)/);
  const cars = has(t, /сколько.{0,12}(машин|авто|заезд|клиент)|заезд|машин было|приехал/);
  if (money || cars) return {intent: 'stats', period, anchor, focus: money && cars ? 'all' : money ? 'money' : 'cars', explicit};
  if (has(t, /что у меня|какие записи|кто.{0,10}(записан|приедет|будет)|расписани|записи|загрузк|план/)) return {intent: 'bookings', period, anchor};
  if (has(t, /статистик|итог|отчет|сводк/)) return {intent: 'stats', period, anchor, focus: 'all', explicit};
  return {
    intent: 'clarify',
    question: 'Могу показать записи и посчитать машины или деньги за день, неделю или месяц. Что нужно?',
    options: ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?'],
  };
}
