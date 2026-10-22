import {formatInTimeZone, toZonedTime} from 'date-fns-tz';
import {addDays, differenceInCalendarDays} from 'date-fns';
import {msg} from '../i18n/index.ts';

const moneyCache = new Map<string, Intl.NumberFormat>();
const moneyFormat = (currency: string) => {
  const key = `${msg.intl}|${currency}`;
  let f = moneyCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(msg.intl, {style: 'currency', currency, maximumFractionDigits: 0});
    moneyCache.set(key, f);
  }
  return f;
};

export const formatMoney = (amount: number, currency = 'RUB'): string => moneyFormat(currency).format(amount);

/** «₽», «Kč», «€» — for field labels like «Цена, ₽». */
export const currencySymbol = (currency: string): string =>
  moneyFormat(currency).formatToParts(0).find(p => p.type === 'currency')?.value ?? currency;

/** «от 18 000 ₽», «od 1 600 Kč»; a price of 0 without «от» means «price on request». */
export const formatPrice = (price: number, from: boolean, currency = 'RUB') =>
  price === 0 && !from ? msg.fmt.onRequest : `${from ? msg.fmt.from : ''}${formatMoney(price, currency)}`;

export function formatDuration(minutes: number): string {
  if (minutes >= 1440) return msg.fmt.days(Math.ceil(minutes / 1440));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return msg.fmt.minutes(m);
  return m ? `${msg.fmt.hours(h)} ${msg.fmt.minutes(m)}` : msg.fmt.hours(h);
}

export const plural = (n: number, one: string, few: string, many: string): string => msg.plural(n, one, few, many);

export const fmt = (iso: string | Date, tz: string, pattern: string) => formatInTimeZone(iso, tz, pattern, {locale: msg.dateLocale});

export const formatTime = (iso: string, tz: string) => fmt(iso, tz, 'HH:mm');

/** «сегодня, 14:30», «zítra, 10:00», «пт, 17 октября, 10:00» in the studio's zone. */
export function formatWhen(iso: string, tz: string, now = new Date()): string {
  const diff = differenceInCalendarDays(toZonedTime(iso, tz), toZonedTime(now, tz));
  const time = formatTime(iso, tz);
  if (diff === 0) return `${msg.fmt.today}, ${time}`;
  if (diff === 1) return `${msg.fmt.tomorrow}, ${time}`;
  return `${fmt(iso, tz, msg.fmt.whenDate)}, ${time}`;
}

export const formatDayLabel = (date: string, tz: string, now = new Date()) => {
  const today = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const tomorrow = formatInTimeZone(addDays(now, 1), tz, 'yyyy-MM-dd');
  if (date === today) return msg.fmt.Today;
  if (date === tomorrow) return msg.fmt.Tomorrow;
  return formatInTimeZone(`${date}T12:00:00Z`, 'UTC', msg.fmt.dayChip, {locale: msg.dateLocale});
};

/** A calendar date (YYYY-MM-DD) in the interface language, e.g. «17 октября» / «17. října». */
export const formatDate = (date: string, options: Intl.DateTimeFormatOptions = {day: 'numeric', month: 'long'}) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(msg.intl, {timeZone: 'UTC', ...options});

export const todayIn = (tz: string, now = new Date()) => formatInTimeZone(now, tz, 'yyyy-MM-dd');

/** +79991234567 → +7 999 123-45-67; +420777056596 → +420 777 056 596; +48533557260 → +48 533 557 260. */
export function formatPhone(e164: string): string {
  const ru = e164.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  if (ru) return `+7 ${ru[1]} ${ru[2]}-${ru[3]}-${ru[4]}`;
  const cz = e164.match(/^\+(420|421)(\d{3})(\d{3})(\d{3})$/);
  if (cz) return `+${cz[1]} ${cz[2]} ${cz[3]} ${cz[4]}`;
  const pl = e164.match(/^\+48(\d{3})(\d{3})(\d{3})$/);
  if (pl) return `+48 ${pl[1]} ${pl[2]} ${pl[3]}`;
  return e164;
}

export const weekdayShort = (isoWeekday: number) => msg.fmt.weekdayShort[isoWeekday] ?? '';

/** Group consecutive weekdays with equal hours: «Пн–Пт 09:00–21:00». */
export function summarizeHours(rows: {weekday: number; opens: string; closes: string}[]): {days: string; hours: string; closed: boolean}[] {
  const byDay = new Map<number, string>();
  for (const r of rows) {
    const prev = byDay.get(r.weekday);
    const span = `${r.opens}–${r.closes}`;
    byDay.set(r.weekday, prev ? `${prev}, ${span}` : span);
  }
  const out: {days: string; hours: string; closed: boolean}[] = [];
  let start = 1;
  for (let d = 1; d <= 8; d++) {
    const cur = byDay.get(d) ?? null;
    const startVal = byDay.get(start) ?? null;
    if (d === 8 || cur !== startVal) {
      const end = d - 1;
      out.push({
        days: start === end ? weekdayShort(start) : `${weekdayShort(start)}–${weekdayShort(end)}`,
        hours: startVal ?? msg.fmt.dayOff,
        closed: startVal === null,
      });
      start = d;
    }
  }
  return out;
}
