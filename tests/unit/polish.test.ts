import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {businessSchema} from '../../shared/business.ts';
import {msg, setLang} from '../../src/i18n/index.ts';
import {toApiError} from '../../src/lib/errors.ts';
import {formatDayLabel, formatDuration, formatPhone, formatPrice, formatWhen, summarizeHours} from '../../src/lib/format.ts';
import {customerSchema, toE164} from '../../src/lib/schemas.ts';
import {clientFallback, type ClientSource} from '../../supabase/functions/_shared/client-domain.ts';
import {ownerFallback} from '../../supabase/functions/_shared/owner-domain.ts';
import {routeClient, routeOwner} from '../../supabase/functions/_shared/router.ts';
import {duration, money, when} from '../../supabase/functions/_shared/text.ts';

const sp = (s: string) => s.replace(/\s/g, ' ');

describe('Polish interface', () => {
  beforeAll(() => setLang('pl'));
  afterAll(() => setLang('ru'));

  it('formats prices, durations and dates the Polish way', () => {
    expect(sp(formatPrice(1050, true, 'PLN'))).toBe('od 1050 zł');
    expect(sp(formatPrice(2350, true, 'PLN'))).toBe('od 2350 zł');
    expect(sp(formatPrice(12000, false, 'PLN'))).toBe('12 000 zł');
    expect(formatPrice(0, false, 'PLN')).toBe('cena do ustalenia');
    expect(formatDuration(90)).toBe('1 godz. 30 min');
    expect(formatDuration(1440)).toBe('1 dzień');
    expect(formatDuration(2880)).toBe('2 dni');
    const now = new Date('2026-10-19T08:00:00Z'); // Monday
    expect(formatWhen('2026-10-19T12:00:00Z', 'Europe/Warsaw', now)).toBe('dziś, 14:00');
    expect(formatWhen('2026-10-20T07:30:00Z', 'Europe/Warsaw', now)).toBe('jutro, 09:30');
    expect(formatWhen('2026-10-22T07:30:00Z', 'Europe/Warsaw', now)).toBe('czw, 22 października, 09:30');
    expect(formatDayLabel('2026-10-23', 'Europe/Warsaw', now)).toBe('pią 23.10');
  });

  it('accepts Polish phone numbers', () => {
    expect(toE164('533 557 260')).toBe('+48533557260');
    expect(toE164('533-557-260')).toBe('+48533557260');
    expect(toE164('0048 533 557 260')).toBe('+48533557260');
    expect(toE164('+48 533 557 260')).toBe('+48533557260');
    expect(formatPhone('+48533557260')).toBe('+48 533 557 260');
    const r = customerSchema.safeParse({name: 'J', phone: '12', car: '', comment: ''});
    expect(r.error!.issues.map(i => i.message)).toEqual(['Podaj imię', 'Telefon w formacie +48 533 123 456', 'Podaj markę i model']);
  });

  it('translates server errors by code', () => {
    expect(toApiError({message: 'SLOT_TAKEN', hint: 'Это время только что заняли. Выберите другое.'}).message).toBe(msg.errors.codes.SLOT_TAKEN);
    expect(toApiError({message: 'SOMETHING_NEW', hint: 'по-русски'}).message).toBe('Coś poszło nie tak. Spróbuj ponownie.');
  });

  it('names closed days in Polish', () => {
    const rows = [1, 2, 3, 4, 5].map(d => ({weekday: d, opens: '08:00', closes: '18:00'}));
    expect(summarizeHours(rows)).toEqual([
      {days: 'Pn–Pt', hours: '08:00–18:00', closed: false},
      {days: 'Sob–Nd', hours: 'Zamknięte', closed: true},
    ]);
  });
});

describe('Detailing Studio MS config', () => {
  const config = businessSchema.parse(JSON.parse(readFileSync('tenants/ms-detailing-studio/business.json', 'utf8')));
  it('is a Polish studio priced in złoty', () => {
    expect(config.locale).toBe('pl-PL');
    expect(config.currency).toBe('PLN');
    expect(config.timezone).toBe('Europe/Warsaw');
    expect(config.contacts.phone).toBe('+48533557260');
  });
});

describe('Polish assistant without a model', () => {
  const TZ = 'Europe/Warsaw';
  const NOW = new Date('2026-10-19T08:00:00Z'); // Monday 10:00 in Warsaw
  const services = [
    {id: 'ws', name: 'Czyszczenie wnętrza (standard)', category: 'Mycie i wnętrze'},
    {id: 'wp', name: 'Czyszczenie wnętrza (premium)', category: 'Mycie i wnętrze'},
    {id: 'k1', name: 'Korekta lakieru 1-etapowa', category: 'Korekta i powłoki'},
    {id: 'cer', name: 'Powłoka ceramiczna 2 lata', category: 'Korekta i powłoki'},
    {id: 'tap', name: 'Pranie tapicerki materiałowej', category: 'Mycie i wnętrze'},
  ];

  it('routes the example questions', () => {
    expect(routeClient('Kiedy najbliższy wolny termin?', services, TZ, NOW, 'pl')).toMatchObject({intent: 'clarify'});
    expect(routeClient('Ile kosztuje czyszczenie wnętrza?', services, TZ, NOW, 'pl')).toMatchObject({intent: 'price'});
    expect((routeClient('Ile kosztuje czyszczenie wnętrza?', services, TZ, NOW, 'pl') as {serviceIds: string[]}).serviceIds.slice(0, 2).sort()).toEqual(['wp', 'ws']);
    expect(routeClient('Gdzie was znajdę?', services, TZ, NOW, 'pl')).toEqual({intent: 'location'});
  });

  it('understands services, dates and words without diacritics', () => {
    expect(routeClient('macie wolny termin na ceramike w piatek?', services, TZ, NOW, 'pl')).toEqual({intent: 'nearest_slot', serviceId: 'cer', dateFrom: '2026-10-23'});
    expect(routeClient('Chcę pranie tapicerki, macie jutro termin?', services, TZ, NOW, 'pl')).toEqual({intent: 'nearest_slot', serviceId: 'tap', dateFrom: '2026-10-20'});
    expect(routeClient('Czy można umówić korektę lakieru na 5 listopada?', services, TZ, NOW, 'pl')).toEqual({intent: 'nearest_slot', serviceId: 'k1', dateFrom: '2026-11-05'});
    expect(routeClient('Do której jesteście otwarci?', services, TZ, NOW, 'pl')).toEqual({intent: 'hours'});
  });

  it('routes owner questions', () => {
    expect(routeOwner('Co mam jutro?', TZ, NOW, 'pl')).toEqual({intent: 'bookings', period: 'day', anchor: '2026-10-20'});
    expect(routeOwner('Ile aut było w tym tygodniu?', TZ, NOW, 'pl')).toMatchObject({intent: 'stats', period: 'week', focus: 'cars', explicit: true});
    expect(routeOwner('Ile pieniędzy otrzymaliśmy?', TZ, NOW, 'pl')).toMatchObject({intent: 'stats', focus: 'money', explicit: false});
  });

  it('writes template answers in Polish', async () => {
    expect(sp(money(1050, 'PLN', 'pl'))).toBe('1050 zł');
    expect(duration(2880, 'pl')).toBe('2 dni');
    expect(when('2026-10-20T07:30:00Z', TZ, NOW, 'pl')).toBe('jutro o 09:30');
    const src: ClientSource = {
      tenant: {
        slug: 'ms',
        name: 'Detailing Studio MS',
        status: 'live',
        timezone: TZ,
        currency: 'PLN',
        locale: 'pl-PL',
        phone: '+48533557260',
        address: 'ul. Ziemska 6, Bydgoszcz',
        map_url: null,
        services: services.map(s => ({...s, price: 650, price_from: true, duration_minutes: 90, description: ''})),
        hours: [{weekday: 1, opens: '08:00', closes: '18:00'}],
        exceptions: [],
        booking: {horizon_days: 30},
      },
      availability: async () => ({timezone: TZ, horizon_end: '2026-11-30', days: [{date: '2026-10-20', slots: [{start_at: '2026-10-20T07:30:00Z', available: true}]}]}),
    };
    const loc = await clientFallback(src, 'Gdzie was znajdę?');
    expect(loc.text).toContain('Znajdziesz nas pod adresem ul. Ziemska 6');
    expect(loc.text).toContain('+48 533 557 260');
    const slot = await clientFallback(src, 'Macie wolny termin na powłokę ceramiczną?');
    expect(slot.text).toMatch(/^Najbliższe wolne terminy na „Powłoka ceramiczna 2 lata”: .+ o 09:30/);
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
      {timezone: TZ, currency: 'PLN', studioName: 'MS', lang: 'pl', stats: async () => stats, bookings: async () => []},
      'Ile pieniędzy otrzymaliśmy?',
    );
    expect(sp(owner.text)).toContain('Dziś: otrzymano 5000 zł.');
  });
});

describe('MS FAQ in the assistant fallback', () => {
  const config = businessSchema.parse(JSON.parse(readFileSync('tenants/ms-detailing-studio/business.json', 'utf8')));
  const services = config.services.map(s => ({id: s.key, name: s.name, category: s.category}));
  const ask = (q: string) => {
    const r = routeClient(q, services, 'Europe/Warsaw', new Date('2026-10-19T08:00:00Z'), 'pl', config.faq);
    return r.intent === 'faq' ? config.faq[r.index]!.question : r.intent;
  };
  it('answers the studio questions with the studio answers', () => {
    expect(ask('Czy odbierzecie auto spod domu?')).toBe('Czy odbieracie auto od klienta?');
    expect(ask('Macie jakieś rabaty?')).toBe('Czy macie rabaty?');
    expect(ask('Robicie też SUV-y?')).toBe('Czy pracujecie tylko z samochodami osobowymi?');
    expect(ask('Gdzie was znajdę?')).toBe('Gdzie was znajdę?');
  });
  it('keeps prices and free time of a named service on live data', () => {
    expect(ask('Ile kosztuje pakiet SHINE?')).toBe('price');
    expect(ask('Macie wolny termin na pranie tapicerki?')).toBe('nearest_slot');
  });
});
