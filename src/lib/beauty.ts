/** Beauty studio helpers for the browser (opening state of the studio). */
import {formatInTimeZone, fromZonedTime} from 'date-fns-tz';

type Hours = {weekday: number; opens: string; closes: string}[];
type Exception = {day: string; is_closed: boolean; opens: string | null; closes: string | null};

export type OpenState = {open: true; until: string} | {open: false; next: {date: string; opens: string} | null};

/**
 * Is the studio open now (studio time zone)? Dated exceptions win over the
 * weekly hours. When closed, the next opening within two weeks.
 */
export function openState(hours: Hours, exceptions: Exception[], tz: string, now = new Date()): OpenState {
  const dayIntervals = (date: string): [string, string][] => {
    const ex = exceptions.find(e => e.day === date);
    if (ex) return ex.is_closed || !ex.opens || !ex.closes ? [] : [[ex.opens, ex.closes]];
    const wd = Number(formatInTimeZone(fromZonedTime(`${date}T12:00:00`, tz), tz, 'i'));
    return hours.filter(h => h.weekday === wd).map(h => [h.opens.slice(0, 5), h.closes.slice(0, 5)] as [string, string]);
  };
  const today = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const time = formatInTimeZone(now, tz, 'HH:mm');
  const current = dayIntervals(today).find(([a, b]) => a <= time && time < b);
  if (current) return {open: true, until: current[1]};
  for (let i = 0; i < 14; i++) {
    const date = formatInTimeZone(new Date(fromZonedTime(`${today}T12:00:00`, tz).getTime() + i * 86_400_000), tz, 'yyyy-MM-dd');
    const next = dayIntervals(date)
      .filter(([a]) => i > 0 || a > time)
      .sort()[0];
    if (next) return {open: false, next: {date, opens: next[0]}};
  }
  return {open: false, next: null};
}
