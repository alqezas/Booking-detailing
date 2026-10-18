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

describe('Czech interface', () => {
  beforeAll(() => setLang('cs'));
  afterAll(() => setLang('ru'));

  it('formats prices, durations and dates the Czech way', () => {
    expect(sp(formatPrice(1600, true, 'CZK'))).toBe('od 1 600 Kč');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(1440)).toBe('1 den');
    expect(formatDuration(2880)).toBe('2 dny');
    expect(formatDuration(7200)).toBe('5 dní');
    const now = new Date('2026-10-19T08:00:00Z'); // Monday
    expect(formatWhen('2026-10-19T12:00:00Z', 'Europe/Prague', now)).toBe('dnes, 14:00');
    expect(formatWhen('2026-10-20T07:30:00Z', 'Europe/Prague', now)).toBe('zítra, 09:30');
    expect(formatWhen('2026-10-22T07:30:00Z', 'Europe/Prague', now)).toBe('čt 22. října, 09:30');
    expect(formatDayLabel('2026-10-23', 'Europe/Prague', now)).toBe('pá 23. 10.');
  });

  it('accepts Czech phone numbers', () => {
    expect(toE164('777 056 596')).toBe('+420777056596');
    expect(toE164('00420 777 056 596')).toBe('+420777056596');
    expect(toE164('+420 777 056 596')).toBe('+420777056596');
    expect(formatPhone('+420777056596')).toBe('+420 777 056 596');
    const r = customerSchema.safeParse({name: 'J', phone: '12', car: '', comment: ''});
    expect(r.error!.issues.map(i => i.message)).toEqual(['Zadejte jméno', 'Telefon ve formátu +420 777 123 456', 'Zadejte značku a model']);
  });

  it('translates server errors by code', () => {
    expect(toApiError({message: 'SLOT_TAKEN', hint: 'Это время только что заняли. Выберите другое.'}).message).toBe(msg.errors.codes.SLOT_TAKEN);
    expect(toApiError({message: 'SOMETHING_NEW', hint: 'по-русски'}).message).toBe('Něco se pokazilo. Zkuste to prosím znovu.');
  });

  it('names closed days in Czech', () => {
    const rows = [1, 2, 3, 4, 5].map(d => ({weekday: d, opens: '08:00', closes: '17:00'}));
    expect(summarizeHours(rows)).toEqual([
      {days: 'Po–Pá', hours: '08:00–17:00', closed: false},
      {days: 'So–Ne', hours: 'Zavřeno', closed: true},
    ]);
  });
});

describe('JH Auto Detailing config', () => {
  const config = businessSchema.parse(JSON.parse(readFileSync('tenants/jh-auto-detailing/business.json', 'utf8')));
  it('is a Czech studio priced in crowns', () => {
    expect(config.locale).toBe('cs-CZ');
    expect(config.currency).toBe('CZK');
    expect(config.contacts.phone).toBe('+420777056596');
    expect(config.contacts.legalAddress).toContain('Květnická 1621');
    expect(config.gallery.filter(g => g.before)).toHaveLength(6);
  });
});

describe('Czech assistant without a model', () => {
  const TZ = 'Europe/Prague';
  const NOW = new Date('2026-10-19T08:00:00Z'); // Monday 10:00 in Prague
  const services = [
    {id: 'i1', name: 'Interiér 1: Základní čištění', category: 'Interiér'},
    {id: 'i2', name: 'Interiér 2: Detailní údržba', category: 'Interiér'},
    {id: 'i3', name: 'Interiér 3: Čištění a tepování', category: 'Interiér'},
    {id: 'bronz', name: 'Leštění laku Bronz', category: 'Leštění laku'},
    {id: 'ker', name: 'Keramická ochrana laku', category: 'Ochrana laku'},
    {id: 'tint', name: 'Tónování zadních oken', category: 'Tónování oken'},
  ];

  it('routes the example questions', () => {
    expect(routeClient('Kdy je nejbližší volný termín?', services, TZ, NOW, 'cs')).toMatchObject({intent: 'clarify'});
    expect(routeClient('Kolik stojí čištění interiéru?', services, TZ, NOW, 'cs')).toEqual({intent: 'price', serviceIds: ['i1', 'i3', 'i2']});
    expect(routeClient('Kde vás najdu?', services, TZ, NOW, 'cs')).toEqual({intent: 'location'});
  });

  it('understands services, dates and words without diacritics', () => {
    expect(routeClient('mate volno na keramiku v patek?', services, TZ, NOW, 'cs')).toEqual({intent: 'nearest_slot', serviceId: 'ker', dateFrom: '2026-10-23'});
    expect(routeClient('Chci tónování, máte zítra termín?', services, TZ, NOW, 'cs')).toEqual({intent: 'nearest_slot', serviceId: 'tint', dateFrom: '2026-10-20'});
    expect(routeClient('Lze se objednat na leštění 5. listopadu?', services, TZ, NOW, 'cs')).toEqual({intent: 'nearest_slot', serviceId: 'bronz', dateFrom: '2026-11-05'});
    expect(routeClient('Do kolika máte otevřeno?', services, TZ, NOW, 'cs')).toEqual({intent: 'hours'});
  });

  it('routes owner questions', () => {
    expect(routeOwner('Co mám zítra?', TZ, NOW, 'cs')).toEqual({intent: 'bookings', period: 'day', anchor: '2026-10-20'});
    expect(routeOwner('Kolik aut bylo tento týden?', TZ, NOW, 'cs')).toMatchObject({intent: 'stats', period: 'week', focus: 'cars', explicit: true});
    expect(routeOwner('Kolik peněz jsme přijali?', TZ, NOW, 'cs')).toMatchObject({intent: 'stats', focus: 'money', explicit: false});
  });

  it('writes template answers in Czech', async () => {
    expect(sp(money(1600, 'CZK', 'cs'))).toBe('1 600 Kč');
    expect(duration(2880, 'cs')).toBe('2 dny');
    expect(when('2026-10-20T07:30:00Z', TZ, NOW, 'cs')).toBe('zítra v 09:30');
    const src: ClientSource = {
      tenant: {
        slug: 'jh',
        name: 'JH Auto Detailing',
        status: 'live',
        timezone: TZ,
        currency: 'CZK',
        locale: 'cs-CZ',
        phone: '+420777056596',
        address: 'Olbrachtova 1740, 666 03 Tišnov',
        map_url: null,
        services: services.map(s => ({...s, price: 1600, price_from: true, duration_minutes: 90, description: ''})),
        hours: [{weekday: 1, opens: '08:00', closes: '17:00'}],
        exceptions: [],
        booking: {horizon_days: 30},
      },
      availability: async () => ({timezone: TZ, horizon_end: '2026-11-30', days: [{date: '2026-10-20', slots: [{start_at: '2026-10-20T07:30:00Z', available: true}]}]}),
    };
    const loc = await clientFallback(src, 'Kde vás najdu?');
    expect(loc.text).toContain('Najdete nás na adrese Olbrachtova 1740');
    expect(loc.text).toContain('+420 777 056 596');
    const slot = await clientFallback(src, 'Máte volný termín na keramiku?');
    expect(slot.text).toMatch(/^Nejbližší volné termíny na „Keramická ochrana laku“: .+ v 09:30/);
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
      {timezone: TZ, currency: 'CZK', studioName: 'JH', lang: 'cs', stats: async () => stats, bookings: async () => []},
      'Kolik peněz jsme přijali?',
    );
    expect(sp(owner.text)).toContain('Dnes: přijato 5 000 Kč.');
  });
});

describe('JH FAQ in the assistant fallback', () => {
  const config = businessSchema.parse(JSON.parse(readFileSync('tenants/jh-auto-detailing/business.json', 'utf8')));
  const services = config.services.map(s => ({id: s.key, name: s.name, category: s.category}));
  const ask = (q: string) => {
    const r = routeClient(q, services, 'Europe/Prague', new Date('2026-10-19T08:00:00Z'), 'cs', config.faq);
    return r.intent === 'faq' ? config.faq[r.index]!.question : r.intent;
  };
  it('answers the studio questions with the studio answers', () => {
    expect(ask('Jak dlouho budu bez auta?')).toBe('Jak dlouho budu bez vozu?');
    expect(ask('Jak dlouho trvá leštění?')).toBe('Jak dlouho budu bez vozu?');
    expect(ask('Je příplatek za SUV?')).toBe('Kolik mě to bude stát?');
    expect(ask('Můžete auto vyzvednout u mě doma?')).toBe('Vyzvednete si vůz u mě?');
    expect(ask('Jak často mám čistit interiér?')).toBe('Jak často má smysl detailní čištění?');
    expect(ask('Mám v autě psí chlupy a je hodně špinavé')).toBe('Co když je vůz opravdu hodně špinavý?');
    expect(ask('Můžu platit kartou?')).toBe('Jak se platí?');
    expect(ask('Kde vás najdu?')).toBe('Jak se ke mně dostanete?');
  });
  it('keeps prices and free time of a named service on live data', () => {
    expect(ask('Kolik stojí čištění interiéru?')).toBe('price');
    expect(ask('Máte volný termín na tónování zadních oken?')).toBe('nearest_slot');
  });
});
