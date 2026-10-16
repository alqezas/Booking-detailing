import {formatInTimeZone, toZonedTime} from 'date-fns-tz';
import {ru} from 'date-fns/locale';
import {addDays, differenceInCalendarDays} from 'date-fns';

const moneyCache = new Map<string, Intl.NumberFormat>();
export function formatMoney(amount: number, currency = 'RUB'): string {
  let f = moneyCache.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', {style: 'currency', currency, maximumFractionDigits: 0});
    moneyCache.set(currency, f);
  }
  return f.format(amount);
}

export const formatPrice = (price: number, from: boolean, currency = 'RUB') =>
  `${from ? 'от ' : ''}${formatMoney(price, currency)}`;

export function formatDuration(minutes: number): string {
  if (minutes >= 1440) {
    const days = Math.ceil(minutes / 1440);
    return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const fmt = (iso: string | Date, tz: string, pattern: string) => formatInTimeZone(iso, tz, pattern, {locale: ru});

export const formatTime = (iso: string, tz: string) => fmt(iso, tz, 'HH:mm');

/** «сегодня, 14:30», «завтра, 10:00», «пт, 17 октября, 10:00» in the studio's zone. */
export function formatWhen(iso: string, tz: string, now = new Date()): string {
  const diff = differenceInCalendarDays(toZonedTime(iso, tz), toZonedTime(now, tz));
  const time = formatTime(iso, tz);
  if (diff === 0) return `сегодня, ${time}`;
  if (diff === 1) return `завтра, ${time}`;
  return `${fmt(iso, tz, 'EEEEEE, d MMMM')}, ${time}`;
}

export const formatDayLabel = (date: string, tz: string, now = new Date()) => {
  const today = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const tomorrow = formatInTimeZone(addDays(now, 1), tz, 'yyyy-MM-dd');
  if (date === today) return 'Сегодня';
  if (date === tomorrow) return 'Завтра';
  return formatInTimeZone(`${date}T12:00:00Z`, 'UTC', 'EEEEEE, d MMM', {locale: ru});
};

export const todayIn = (tz: string, now = new Date()) => formatInTimeZone(now, tz, 'yyyy-MM-dd');

export function formatPhone(e164: string): string {
  const m = e164.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164;
}

const WEEKDAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const weekdayShort = (isoWeekday: number) => WEEKDAY_SHORT[isoWeekday] ?? '';

/** Group consecutive weekdays with equal hours: «Пн–Пт 09:00–21:00». */
export function summarizeHours(rows: {weekday: number; opens: string; closes: string}[]): {days: string; hours: string}[] {
  const byDay = new Map<number, string>();
  for (const r of rows) {
    const prev = byDay.get(r.weekday);
    const span = `${r.opens}–${r.closes}`;
    byDay.set(r.weekday, prev ? `${prev}, ${span}` : span);
  }
  const out: {days: string; hours: string}[] = [];
  let start = 1;
  for (let d = 1; d <= 8; d++) {
    const cur = byDay.get(d) ?? 'Выходной';
    const startVal = byDay.get(start) ?? 'Выходной';
    if (d === 8 || cur !== startVal) {
      const end = d - 1;
      out.push({days: start === end ? weekdayShort(start) : `${weekdayShort(start)}–${weekdayShort(end)}`, hours: startVal});
      start = d;
    }
  }
  return out;
}
