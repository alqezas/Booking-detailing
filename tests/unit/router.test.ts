import {describe, expect, it} from 'vitest';
import {matchServices, parseDate, routeClient, routeOwner} from '../../supabase/functions/_shared/router.ts';

const services = [
  {id: 'wash', name: 'Детейлинг-мойка', category: 'Мойка'},
  {id: 'lights', name: 'Полировка фар', category: 'Полировка'},
  {id: 'polish', name: 'Полировка кузова', category: 'Полировка'},
  {id: 'ceramic', name: 'Керамическое покрытие', category: 'Защита'},
];
const TZ = 'Europe/Moscow';
// Friday 16 Oct 2026, 10:00 Moscow
const NOW = new Date('2026-10-16T07:00:00Z');

describe('client router', () => {
  it('routes the three example questions', () => {
    expect(routeClient('Когда ближайшее окно?', services, TZ, NOW)).toMatchObject({intent: 'clarify'});
    const price = routeClient('Сколько стоит полировка?', services, TZ, NOW);
    expect(price).toEqual({intent: 'price', serviceIds: ['lights', 'polish']});
    expect(routeClient('Как найти студию?', services, TZ, NOW)).toEqual({intent: 'location'});
  });

  it('asks a clarifying question when the service is ambiguous for slots', () => {
    const r = routeClient('когда можно на полировку', services, TZ, NOW);
    expect(r.intent).toBe('clarify');
    if (r.intent === 'clarify') expect(r.options).toEqual(['Полировка фар', 'Полировка кузова']);
  });

  it('finds slots for a specific service and date', () => {
    expect(routeClient('Есть свободное время на керамику завтра?', services, TZ, NOW)).toEqual({
      intent: 'nearest_slot',
      serviceId: 'ceramic',
      dateFrom: '2026-10-17',
    });
  });

  it('handles hours, contacts and unknown text', () => {
    expect(routeClient('До скольки вы работаете?', services, TZ, NOW).intent).toBe('hours');
    expect(routeClient('дайте телефон', services, TZ, NOW).intent).toBe('contacts');
    expect(routeClient('привет', services, TZ, NOW).intent).toBe('clarify');
  });

  it('matches inflected service names', () => {
    expect(matchServices('хочу мойку', services).map(s => s.id)).toEqual(['wash']);
    expect(matchServices('керамику бы', services).map(s => s.id)).toEqual(['ceramic']);
  });
});

describe('dates in the studio time zone', () => {
  it('parses relative and named days', () => {
    expect(parseDate('сегодня', TZ, NOW)).toBe('2026-10-16');
    expect(parseDate('послезавтра', TZ, NOW)).toBe('2026-10-18');
    expect(parseDate('в понедельник', TZ, NOW)).toBe('2026-10-19');
    expect(parseDate('в пятницу', TZ, NOW)).toBe('2026-10-23'); // next Friday, not today
    expect(parseDate('на 3 ноября', TZ, NOW)).toBe('2026-11-03');
    expect(parseDate('1 января', TZ, NOW)).toBe('2027-01-01');
  });

  it('uses the studio date, not UTC, near midnight', () => {
    const lateUtc = new Date('2026-10-16T21:30:00Z'); // 00:30 on the 17th in Moscow
    expect(parseDate('завтра', TZ, lateUtc)).toBe('2026-10-18');
  });
});

describe('owner router', () => {
  it('routes the three example questions', () => {
    expect(routeOwner('Что у меня завтра?', TZ, NOW)).toEqual({intent: 'bookings', period: 'day', anchor: '2026-10-17'});
    expect(routeOwner('Сколько машин было на неделе?', TZ, NOW)).toEqual({intent: 'stats', period: 'week', anchor: '2026-10-16', focus: 'cars'});
    expect(routeOwner('Сколько денег получено?', TZ, NOW)).toEqual({intent: 'stats', period: 'day', anchor: '2026-10-16', focus: 'money'});
  });

  it('understands previous periods', () => {
    expect(routeOwner('выручка за прошлую неделю', TZ, NOW)).toMatchObject({period: 'week', anchor: '2026-10-09', focus: 'money'});
    expect(routeOwner('сколько денег в прошлом месяце', TZ, NOW)).toMatchObject({period: 'month', anchor: '2026-09-30'});
    expect(routeOwner('сколько заездов вчера', TZ, NOW)).toMatchObject({period: 'day', anchor: '2026-10-15', focus: 'cars'});
  });

  it('asks when the request is unclear', () => {
    expect(routeOwner('привет', TZ, NOW).intent).toBe('clarify');
  });
});
