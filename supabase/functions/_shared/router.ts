/**
 * Deterministic intent router. Used three ways:
 *  1. as the fallback when the model is unavailable or over budget,
 *  2. to validate / repair a model's JSON intent,
 *  3. in tests, as the reference behaviour.
 * It never touches data: it only decides WHICH allowed tool to run with
 * WHICH arguments, or which clarifying question to ask.
 */
import {texts, type Lang} from './lang.ts';
import {localDate, norm, stem, words} from './text.ts';

export type ServiceRef = {id: string; name: string; category?: string};
export type FaqRef = {question: string; keywords?: string[]};

/**
 * The studio's FAQ entry the question is about: most keyword hits wins.
 * Keywords are compared without diacritics, as substrings of the question.
 */
export function matchFaq(text: string, faq: FaqRef[], lang: Lang = 'ru'): number | null {
  const t = ` ${norm(text, lang)} `;
  let best: number | null = null;
  let bestScore = 0;
  faq.forEach((f, i) => {
    const score = (f.keywords ?? []).filter(k => t.includes(norm(k, lang))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export type ClientIntent =
  | {intent: 'nearest_slot'; serviceId: string; dateFrom: string | null}
  | {intent: 'price'; serviceIds: string[]}
  | {intent: 'location'}
  | {intent: 'hours'}
  | {intent: 'services'}
  | {intent: 'contacts'}
  | {intent: 'faq'; index: number}
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
/** «керамику» ~ «керамическое», «keramiku» ~ «keramika»: long shared prefix of the stems. */
const sameStem = (a: string, b: string) => commonPrefix(a, b) >= Math.min(5, a.length, b.length);

/**
 * Services mentioned in the text. By default only the best-scoring ones (to
 * pick one service for free time); `any` keeps every mention, best first —
 * a price question about «čištění interiéru» lists all interior packages.
 */
export function matchServices(text: string, services: ServiceRef[], lang: Lang = 'ru', any = false): ServiceRef[] {
  const w = words(text, lang).map(x => stem(x, lang));
  const scored = services
    .map(s => {
      const sw = words(`${s.name} ${s.category ?? ''}`, lang).map(x => stem(x, lang));
      const score = sw.filter(x => w.some(y => sameStem(x, y))).length;
      return {s, score};
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  if (any) return scored.map(x => x.s);
  const best = scored[0]!.score;
  return scored.filter(x => x.score === best).map(x => x.s);
}

/**
 * Keyword patterns per language. Czech patterns are written without
 * diacritics: norm() strips them from the question first.
 */
const PATTERNS = {
  ru: {
    weekdays: [
      [/понедельник/, 1],
      [/вторник/, 2],
      [/сред[уа]/, 3],
      [/четверг/, 4],
      [/пятниц/, 5],
      [/суббот/, 6],
      [/воскресень/, 7],
    ] as [RegExp, number][],
    afterTomorrow: /послезавтра/,
    tomorrow: /завтра/,
    today: /сегодня/,
    weekend: /выходн/,
    months: ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'],
    dayMonth: /(\d{1,2})\s+([а-я]+)/,
    location: /(как|где).{0,20}(найти|добрат|доехат|проехат|находит)|адрес|маршрут|на карте/,
    price: /(сколько|почем|почём).{0,15}(стоит|стоят|будет)|цен[аыу]|стоимост|прайс|по деньгам/,
    slot: /ближайш|свободн|окн[оа]|когда.{0,15}(можно|получится|запис|приехат)|есть.{0,10}(время|место)|записат|запиши/,
    hours: /график|час[ыа] работ|режим|во сколько|до скольки|открыт|работаете/,
    services: /какие услуги|что.{0,10}(делаете|умеете|есть)|список|услуги/,
    contacts: /телефон|позвонить|связат|whatsapp|телеграм|telegram/,
    explicit: /недел|месяц|вчера|сегодня|завтра|понедельник|вторник|сред[уа]|четверг|пятниц|суббот|воскресень|\d{1,2}\s+[а-я]+/,
    lastWeek: /прошл\S* недел/,
    week: /недел/,
    lastMonth: /прошл\S* месяц/,
    month: /месяц/,
    yesterday: /вчера/,
    money: /денег|деньги|выручк|получен|заработ|оплат|касс|сколько.{0,10}(рубл|₽)/,
    cars: /сколько.{0,12}(машин|авто|заезд|клиент)|заезд|машин было|приехал/,
    bookings: /что у меня|какие записи|кто.{0,10}(записан|приедет|будет)|расписани|записи|загрузк|план/,
    stats: /статистик|итог|отчет|сводк/,
  },
  cs: {
    weekdays: [
      [/pondel/, 1],
      [/uter/, 2],
      [/stred/, 3],
      [/ctvrt/, 4],
      [/patek|patku/, 5],
      [/sobot/, 6],
      [/nedel/, 7],
    ] as [RegExp, number][],
    afterTomorrow: /pozitri/,
    tomorrow: /zitra/,
    today: /dnes/,
    weekend: /vikend/,
    // Genitive month names («18. října»); the longest matching prefix wins («cervenc» over «cerven»).
    months: ['ledn', 'unor', 'brez', 'dub', 'kvet', 'cerven', 'cervenc', 'srp', 'zari', 'rij', 'listopad', 'prosin'],
    dayMonth: /(\d{1,2})\.?\s+([a-z]+)/,
    location: /(kde|jak).{0,20}(najdu|najit|najdeme|dojet|dostat|jste|sidlite)|adres|navigac|na mape|mapa|cesta k vam/,
    price: /(kolik|za kolik).{0,15}(stoji|stoj|bude|vyjde)|cen[aiuy]|cenik/,
    slot: /nejbliz|voln|termin|kdy.{0,15}(muzu|muzeme|jde|lze|prijet|objednat|mate)|objednat|rezerv|mate.{0,10}(cas|misto)/,
    hours: /oteviraci|otevreno|do kolika|od kolika|v kolik|pracovni doba|provozni doba|kdy mate otevr/,
    services: /jake sluzby|co.{0,10}(delate|nabizite|umite)|sluzby|nabidk/,
    contacts: /telefon|zavolat|kontakt|whatsapp|telegram|e-?mail/,
    explicit: /tyden|tydnu|tydne|mesic|vcera|dnes|zitra|pondel|uter|stred|ctvrt|patek|sobot|nedel|\d{1,2}\.?\s+[a-z]+/,
    lastWeek: /minul\S* tyd/,
    week: /tyden|tydnu|tydne/,
    lastMonth: /minul\S* mesic/,
    month: /mesic/,
    yesterday: /vcera/,
    money: /penez|penize|trzb|prijat|prijal|vydel|platb|kasa|kolik.{0,10}(korun|kc)/,
    cars: /kolik.{0,12}(aut|vozu|vozidel|zakazn|prijezd)|prijezd|aut bylo|prijel/,
    bookings: /co mam|jake rezervace|kdo.{0,10}(prijede|je objednan|bude)|rozvrh|rezervac|objednav|vytizen|plan/,
    stats: /statistik|souhrn|prehled|report|vysledk/,
  },
};

/** «завтра», «в субботу», «18 октября» / «zítra», «v sobotu», «18. října» → local date. */
export function parseDate(text: string, tz: string, now = new Date(), lang: Lang = 'ru'): string | null {
  const p = PATTERNS[lang];
  const t = norm(text, lang);
  if (p.afterTomorrow.test(t)) return localDate(tz, 2, now);
  if (p.tomorrow.test(t)) return localDate(tz, 1, now);
  if (p.today.test(t)) return localDate(tz, 0, now);
  const todayIso = isoWeekday(tz, now);
  if (p.weekend.test(t)) return localDate(tz, (6 - todayIso + 7) % 7, now);
  for (const [re, iso] of p.weekdays) {
    if (re.test(t)) return localDate(tz, (iso - todayIso + 7) % 7 || 7, now);
  }
  const m = t.match(p.dayMonth);
  if (m) {
    let mi = -1;
    p.months.forEach((prefix, i) => {
      if (m[2]!.startsWith(prefix) && (mi < 0 || prefix.length > p.months[mi]!.length)) mi = i;
    });
    if (mi >= 0) {
      const year = Number(localDate(tz, 0, now).slice(0, 4));
      const candidate = `${year}-${String(mi + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
      return candidate < localDate(tz, 0, now) ? `${year + 1}${candidate.slice(4)}` : candidate;
    }
  }
  return null;
}

export function routeClient(
  text: string,
  services: ServiceRef[],
  tz: string,
  now = new Date(),
  lang: Lang = 'ru',
  faq: FaqRef[] = [],
): ClientIntent {
  const p = PATTERNS[lang];
  const say = texts(lang);
  const t = norm(text, lang);
  const mentioned = matchServices(t, services, lang);
  const names = services.map(s => s.name);

  // A price or free time for a named service is answered from data; anything
  // else the studio has written an answer for is answered with that answer.
  if (!(mentioned.length && (has(t, p.price) || has(t, p.slot)))) {
    const f = matchFaq(text, faq, lang);
    if (f !== null) return {intent: 'faq', index: f};
  }

  if (has(t, p.location)) return {intent: 'location'};
  if (has(t, p.price)) {
    const priced = matchServices(t, services, lang, true);
    if (priced.length) return {intent: 'price', serviceIds: priced.map(s => s.id)};
    return {intent: 'price', serviceIds: services.map(s => s.id)};
  }
  if (has(t, p.slot)) {
    if (mentioned.length === 1) return {intent: 'nearest_slot', serviceId: mentioned[0]!.id, dateFrom: parseDate(t, tz, now, lang)};
    if (mentioned.length > 1) return {intent: 'clarify', question: say.whichService, options: mentioned.map(s => s.name)};
    if (services.length === 1) return {intent: 'nearest_slot', serviceId: services[0]!.id, dateFrom: parseDate(t, tz, now, lang)};
    return {intent: 'clarify', question: say.whichServiceForSlot, options: names.slice(0, 6)};
  }
  if (has(t, p.hours)) return {intent: 'hours'};
  if (has(t, p.services)) return {intent: 'services'};
  if (has(t, p.contacts)) return {intent: 'contacts'};
  if (mentioned.length) return {intent: 'price', serviceIds: mentioned.map(s => s.id)};
  return {intent: 'clarify', question: say.clientHelp, options: say.clientExamples};
}

export function routeOwner(text: string, tz: string, now = new Date(), lang: Lang = 'ru'): OwnerIntent {
  const p = PATTERNS[lang];
  const say = texts(lang);
  const t = norm(text, lang);
  let period: OwnerPeriod = 'day';
  let anchor = localDate(tz, 0, now);
  const explicit = p.explicit.test(t);
  if (p.lastWeek.test(t)) {
    period = 'week';
    anchor = localDate(tz, -7, now);
  } else if (p.week.test(t)) period = 'week';
  else if (p.lastMonth.test(t)) {
    period = 'month';
    anchor = shiftDate(`${localDate(tz, 0, now).slice(0, 7)}-01`, -1);
  } else if (p.month.test(t)) period = 'month';
  else if (p.yesterday.test(t)) anchor = localDate(tz, -1, now);
  else if (p.tomorrow.test(t)) anchor = localDate(tz, 1, now);
  else {
    const d = parseDate(t, tz, now, lang);
    if (d) anchor = d;
  }

  const money = has(t, p.money);
  const cars = has(t, p.cars);
  if (money || cars) return {intent: 'stats', period, anchor, focus: money && cars ? 'all' : money ? 'money' : 'cars', explicit};
  if (has(t, p.bookings)) return {intent: 'bookings', period, anchor};
  if (has(t, p.stats)) return {intent: 'stats', period, anchor, focus: 'all', explicit};
  return {intent: 'clarify', question: say.ownerHelp, options: say.ownerExamples};
}
