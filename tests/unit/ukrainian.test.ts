import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {msg, setLang} from '../../src/i18n/index.ts';
import {toApiError} from '../../src/lib/errors.ts';
import {formatDuration, formatPhone, formatPrice, formatWhen, summarizeHours} from '../../src/lib/format.ts';
import {customerSchema, toE164} from '../../src/lib/schemas.ts';
import {clientFallback, type ClientSource} from '../../supabase/functions/_shared/client-domain.ts';
import {ownerFallback} from '../../supabase/functions/_shared/owner-domain.ts';
import {routeClient, routeOwner} from '../../supabase/functions/_shared/router.ts';
import {duration, money, when} from '../../supabase/functions/_shared/text.ts';

const sp = (s: string) => s.replace(/\s/g, ' ');

describe('Ukrainian interface', () => {
  beforeAll(() => setLang('uk'));
  afterAll(() => setLang('ru'));

  it('formats prices, durations and dates the Ukrainian way', () => {
    expect(sp(formatPrice(1500, true, 'UAH'))).toBe('від 1 500 ₴');
    expect(sp(formatPrice(12000, false, 'UAH'))).toBe('12 000 ₴');
    expect(formatPrice(0, false, 'UAH')).toBe('ціна за запитом');
    expect(formatDuration(90)).toBe('1 год 30 хв');
    expect(formatDuration(1440)).toBe('1 день');
    expect(formatDuration(2880)).toBe('2 дні');
    const now = new Date('2026-10-19T08:00:00Z'); // Monday
    expect(formatWhen('2026-10-19T12:00:00Z', 'Europe/Kyiv', now)).toBe('сьогодні, 15:00');
    expect(formatWhen('2026-10-20T07:30:00Z', 'Europe/Kyiv', now)).toBe('завтра, 10:30');
  });

  it('accepts Ukrainian phone numbers', () => {
    expect(toE164('050 123 45 67')).toBe('+380501234567');
    expect(toE164('0501234567')).toBe('+380501234567');
    expect(toE164('+38 050 123 45 67')).toBe('+380501234567');
    expect(toE164('380501234567')).toBe('+380501234567');
    expect(formatPhone('+380501234567')).toBe('+380 50 123 45 67');
    const r = customerSchema.safeParse({name: 'О', phone: '12', car: '', comment: ''});
    expect(r.error!.issues.map(i => i.message)).toEqual(['Вкажіть імʼя', 'Телефон у форматі +380 50 123 45 67', 'Вкажіть марку й модель']);
  });

  it('translates server errors by code', () => {
    expect(toApiError({message: 'SLOT_TAKEN', hint: 'Это время только что заняли. Выберите другое.'}).message).toBe(msg.errors.codes.SLOT_TAKEN);
    expect(toApiError({message: 'SOMETHING_NEW', hint: 'по-русски'}).message).toBe('Щось пішло не так. Спробуйте ще раз.');
  });

  it('names closed days in Ukrainian', () => {
    const rows = [1, 2, 3, 4, 5].map(d => ({weekday: d, opens: '09:00', closes: '18:00'}));
    expect(summarizeHours(rows)).toEqual([
      {days: 'Пн–Пт', hours: '09:00–18:00', closed: false},
      {days: 'Сб–Нд', hours: 'Вихідний', closed: true},
    ]);
  });
});

describe('Ukrainian assistant without a model', () => {
  const TZ = 'Europe/Kyiv';
  const NOW = new Date('2026-10-19T08:00:00Z'); // Monday 11:00 in Kyiv
  const services = [
    {id: 'mw', name: 'Мийка кузова', category: 'Мийка'},
    {id: 'hc', name: 'Хімчистка салону', category: 'Салон'},
    {id: 'pl', name: 'Полірування кузова', category: 'Кузов'},
    {id: 'cer', name: 'Керамічне покриття', category: 'Захист'},
  ];

  it('routes the example questions', () => {
    expect(routeClient('Коли найближче вільне вікно?', services, TZ, NOW, 'uk')).toMatchObject({intent: 'clarify'});
    expect(routeClient('Скільки коштує полірування?', services, TZ, NOW, 'uk')).toEqual({intent: 'price', serviceIds: ['pl']});
    expect(routeClient('Як знайти студію?', services, TZ, NOW, 'uk')).toEqual({intent: 'location'});
  });

  it('understands services, dates and the apostrophe', () => {
    expect(routeClient('Є вільний час на хімчистку в пʼятницю?', services, TZ, NOW, 'uk')).toEqual({intent: 'nearest_slot', serviceId: 'hc', dateFrom: '2026-10-23'});
    expect(routeClient("Можна записатися на кераміку в п'ятницю?", services, TZ, NOW, 'uk')).toEqual({intent: 'nearest_slot', serviceId: 'cer', dateFrom: '2026-10-23'});
    expect(routeClient('Хочу мийку, є завтра місце?', services, TZ, NOW, 'uk')).toEqual({intent: 'nearest_slot', serviceId: 'mw', dateFrom: '2026-10-20'});
    expect(routeClient('Запишіть на полірування 5 листопада', services, TZ, NOW, 'uk')).toEqual({intent: 'nearest_slot', serviceId: 'pl', dateFrom: '2026-11-05'});
    expect(routeClient('До котрої ви працюєте?', services, TZ, NOW, 'uk')).toEqual({intent: 'hours'});
  });

  it('routes owner questions', () => {
    expect(routeOwner('Що в мене завтра?', TZ, NOW, 'uk')).toEqual({intent: 'bookings', period: 'day', anchor: '2026-10-20'});
    expect(routeOwner('Скільки авто було цього тижня?', TZ, NOW, 'uk')).toMatchObject({intent: 'stats', period: 'week', focus: 'cars', explicit: true});
    expect(routeOwner('Скільки грошей отримано?', TZ, NOW, 'uk')).toMatchObject({intent: 'stats', focus: 'money', explicit: false});
  });

  it('writes template answers in Ukrainian', async () => {
    expect(sp(money(1500, 'UAH', 'uk'))).toBe('1 500 ₴');
    expect(duration(2880, 'uk')).toBe('2 дні');
    expect(when('2026-10-20T07:30:00Z', TZ, NOW, 'uk')).toBe('завтра о 10:30');
    const src: ClientSource = {
      tenant: {
        slug: 'admire',
        name: 'Admire Detailing',
        status: 'live',
        timezone: TZ,
        currency: 'UAH',
        locale: 'uk-UA',
        phone: '+380501234567',
        address: 'вул. Головна 1, Чернівці',
        map_url: null,
        services: services.map(s => ({...s, price: 1500, price_from: true, duration_minutes: 90, description: ''})),
        hours: [{weekday: 1, opens: '09:00', closes: '18:00'}],
        exceptions: [],
        booking: {horizon_days: 30},
      },
      availability: async () => ({timezone: TZ, horizon_end: '2026-11-30', days: [{date: '2026-10-20', slots: [{start_at: '2026-10-20T07:30:00Z', available: true}]}]}),
    };
    const loc = await clientFallback(src, 'Як знайти студію?');
    expect(loc.text).toContain('Ми знаходимося за адресою: вул. Головна 1');
    expect(loc.text).toContain('+380 50 123 45 67');
    const slot = await clientFallback(src, 'Є вільний час на кераміку?');
    expect(slot.text).toMatch(/^Найближчий вільний час на «Керамічне покриття»: .+ о 10:30/);
    const stats = {
      period: 'day' as const,
      from_date: '2026-10-19',
      to_date: '2026-10-19',
      from_at: '',
      to_at: '',
      bookings: 3,
      cancelled: 0,
      no_show: 0,
      arrivals: 2,
      completed: 1,
      received: 5000,
      refunded: 0,
      net_received: 5000,
      expected_value: 9000,
    };
    const owner = await ownerFallback(
      {timezone: TZ, currency: 'UAH', studioName: 'Admire', lang: 'uk', stats: async () => stats, bookings: async () => []},
      'Скільки грошей отримано?',
    );
    expect(sp(owner.text)).toContain('Сьогодні: отримано 5 000 ₴.');
  });
});
