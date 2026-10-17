/** Small text helpers shared by the router and fallback answers (Russian and Czech). */
import {INTL, L, type Lang} from './lang.ts';

/**
 * Lower case, punctuation removed. Russian keeps its letters («ё» → «е»);
 * Czech drops diacritics, so «čištění» and «cisteni» match the same patterns.
 */
export const norm = (s: string, lang: Lang = 'ru') => {
  let t = s.toLowerCase();
  t = lang === 'cs' ? t.normalize('NFD').replace(/\p{M}/gu, '') : t.replace(/ё/g, 'е');
  return t
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Crude stem: drops vowel endings so «полировку» matches «Полировка кузова», «keramiku» — «Keramika». */
export function stem(w: string, lang: Lang = 'ru'): string {
  const vowel = lang === 'cs' ? /[aeiouy]$/ : /[аяуюоеыиьйэ]$/;
  let s = w;
  for (let i = 0; i < 2 && s.length > 3 && vowel.test(s); i++) s = s.slice(0, -1);
  return s;
}

export const words = (s: string, lang: Lang = 'ru') =>
  norm(s, lang)
    .split(/[\s-]+/)
    .filter(w => w.length >= 3);

export function plural(n: number, one: string, few: string, many: string, lang: Lang = 'ru'): string {
  if (lang === 'cs') return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const money = (n: number, currency = 'RUB', lang: Lang = 'ru') =>
  new Intl.NumberFormat(INTL[lang], {style: 'currency', currency, maximumFractionDigits: 0}).format(n);

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

/** +74950001234 → +7 495 000-12-34; +420777056596 → +420 777 056 596 */
export function phone(e164: string): string {
  const ru = e164.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  if (ru) return `+7 ${ru[1]} ${ru[2]}-${ru[3]}-${ru[4]}`;
  const cz = e164.match(/^\+(420|421)(\d{3})(\d{3})(\d{3})$/);
  return cz ? `+${cz[1]} ${cz[2]} ${cz[3]} ${cz[4]}` : e164;
}
