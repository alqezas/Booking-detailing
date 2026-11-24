/** Small text helpers shared by the router and fallback answers (Russian, Czech, Polish and Ukrainian). */
import {INTL, L, type Lang} from './lang.ts';

/**
 * Lower case, punctuation removed. Russian keeps its letters («ё» → «е»);
 * Czech and Polish drop diacritics, so «čištění» ~ «cisteni», «wnętrza» ~ «wnetrza»
 * («ł» has no combining mark and is mapped by hand).
 */
export const norm = (s: string, lang: Lang = 'ru') => {
  let t = s.toLowerCase();
  if (lang === 'ru') t = t.replace(/ё/g, 'е');
  // Ukrainian keeps its letters; the apostrophe inside words («пʼять», «п'ять») is dropped and «ґ» read as «г».
  else if (lang === 'uk') t = t.replace(/[ʼ'’`]/g, '').replace(/ґ/g, 'г');
  else t = t.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/ß/g, 'ss');
  return t
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Crude stem: drops vowel endings so «полировку» matches «Полировка кузова», «keramiku» — «Keramika». */
export function stem(w: string, lang: Lang = 'ru'): string {
  const vowel = lang === 'ru' ? /[аяуюоеыиьйэ]$/ : lang === 'uk' ? /[аяуюоеиіїєьй]$/ : /[aeiouy]$/;
  let s = w;
  for (let i = 0; i < 2 && s.length > 3 && vowel.test(s); i++) s = s.slice(0, -1);
  return s;
}

/**
 * Polish question and filler words that share a prefix with service names
 * («czy» ~ «czyszczenie»), so they must not count as a service mention.
 */
const STOP: Partial<Record<Lang, Set<string>>> = {
  pl: new Set(['czy', 'jak', 'jaka', 'jaki', 'jakie', 'ile', 'gdzie', 'kiedy', 'mozna', 'moge', 'macie', 'jest', 'dla', 'sie', 'czym', 'przy', 'oraz', 'albo', 'lub', 'tak', 'nie']),
};

export const words = (s: string, lang: Lang = 'ru') =>
  norm(s, lang)
    .split(/[\s-]+/)
    .filter(w => w.length >= 3 && !STOP[lang]?.has(w));

export function plural(n: number, one: string, few: string, many: string, lang: Lang = 'ru'): string {
  if (lang === 'cs') return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  if (lang === 'pl' && n === 1) return one;
  if (lang === 'de') return n === 1 ? one : many;
  const m10 = n % 10;
  const m100 = n % 100;
  if ((lang === 'ru' || lang === 'uk') && m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «850 Kč» even in a Russian-language studio: a foreign currency shows its local sign, not its ISO code. */
export const money = (n: number, currency = 'RUB', lang: Lang = 'ru') => {
  const f = new Intl.NumberFormat(INTL[lang], {style: 'currency', currency, maximumFractionDigits: 0});
  const sign = f.formatToParts(0).find(p => p.type === 'currency')?.value ?? '';
  return (/^[A-Z]{3}$/.test(sign) ? new Intl.NumberFormat(INTL[lang], {style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0}) : f).format(n);
};

export function duration(min: number, lang: Lang = 'ru'): string {
  const t = L[lang];
  if (min >= 1440) {
    const d = Math.ceil(min / 1440);
    return `${d} ${plural(d, ...t.days, lang)}`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} ${t.h} ${m} ${t.min}` : `${h} ${t.h}`) : `${m} ${t.min}`;
}

export function when(iso: string, tz: string, now = new Date(), lang: Lang = 'ru'): string {
  const t = L[lang];
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(INTL[lang], {timeZone: tz, hour: '2-digit', minute: '2-digit'}).format(d);
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  if (day(d) === today) return `${t.today} ${t.at} ${time}`;
  if (day(d) === tomorrow) return `${t.tomorrow} ${t.at} ${time}`;
  const date = new Intl.DateTimeFormat(INTL[lang], {timeZone: tz, weekday: 'short', day: 'numeric', month: 'long'}).format(d);
  return `${date} ${t.at} ${time}`;
}

export function localDate(tz: string, offsetDays = 0, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(
    new Date(now.getTime() + offsetDays * 86_400_000),
  );
}

/** +74950001234 → +7 495 000-12-34; +420777056596 → +420 777 056 596; +48533557260 → +48 533 557 260; +380501234567 → +380 50 123 45 67 */
export function phone(e164: string): string {
  const ru = e164.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  if (ru) return `+7 ${ru[1]} ${ru[2]}-${ru[3]}-${ru[4]}`;
  const cz = e164.match(/^\+(420|421)(\d{3})(\d{3})(\d{3})$/);
  if (cz) return `+${cz[1]} ${cz[2]} ${cz[3]} ${cz[4]}`;
  const pl = e164.match(/^\+48(\d{3})(\d{3})(\d{3})$/);
  if (pl) return `+48 ${pl[1]} ${pl[2]} ${pl[3]}`;
  const ua = e164.match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (ua) return `+380 ${ua[1]} ${ua[2]} ${ua[3]} ${ua[4]}`;
  // Austria: Vienna landline «+43 1 920 8295», mobile «+43 664 123 4567».
  const at = e164.match(/^\+43(1|6\d\d|[2-57-9]\d{1,3})(\d{3})(\d{2,})$/);
  return at ? `+43 ${at[1]} ${at[2]} ${at[3]}` : e164;
}
