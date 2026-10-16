/** Small Russian text helpers shared by the router and fallback answers. */

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Crude Russian stem: drops vowel endings so «полировку» matches «Полировка кузова». */
export function stem(w: string): string {
  let s = w;
  for (let i = 0; i < 2 && s.length > 3 && /[аяуюоеыиьйэ]$/.test(s); i++) s = s.slice(0, -1);
  return s;
}

export const words = (s: string) =>
  norm(s)
    .split(/[\s-]+/)
    .filter(w => w.length >= 3);

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const money = (n: number, currency = 'RUB') =>
  new Intl.NumberFormat('ru-RU', {style: 'currency', currency, maximumFractionDigits: 0}).format(n);

export function duration(min: number): string {
  if (min >= 1440) {
    const d = Math.ceil(min / 1440);
    return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
}

export function when(iso: string, tz: string, now = new Date()): string {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('ru-RU', {timeZone: tz, hour: '2-digit', minute: '2-digit'}).format(d);
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  if (day(d) === today) return `сегодня в ${time}`;
  if (day(d) === tomorrow) return `завтра в ${time}`;
  const date = new Intl.DateTimeFormat('ru-RU', {timeZone: tz, weekday: 'short', day: 'numeric', month: 'long'}).format(d);
  return `${date} в ${time}`;
}

export function localDate(tz: string, offsetDays = 0, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(
    new Date(now.getTime() + offsetDays * 86_400_000),
  );
}
