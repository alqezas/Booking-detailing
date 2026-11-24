import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {beautyMsg} from '../../src/i18n/beauty.ts';
import {msg, setLang} from '../../src/i18n/index.ts';
import {toApiError} from '../../src/lib/errors.ts';
import {formatDuration, formatPhone, formatPrice, formatWhen, summarizeHours} from '../../src/lib/format.ts';
import {personSchema, toE164} from '../../src/lib/schemas.ts';
import {clientFallback, type ClientSource} from '../../supabase/functions/_shared/client-domain.ts';
import {ownerFallback} from '../../supabase/functions/_shared/owner-domain.ts';
import {routeClient, routeOwner} from '../../supabase/functions/_shared/router.ts';
import {duration, money, when} from '../../supabase/functions/_shared/text.ts';

const sp = (s: string) => s.replace(/\s/g, ' ');

describe('German interface (Austria)', () => {
  beforeAll(() => setLang('de'));
  afterAll(() => setLang('ru'));

  it('formats prices, durations and dates the Austrian way', () => {
    expect(sp(formatPrice(20, false, 'EUR'))).toBe('€ 20');
    expect(sp(formatPrice(15, true, 'EUR'))).toBe('ab € 15');
    expect(formatPrice(0, false, 'EUR')).toBe('Preis auf Anfrage');
    expect(formatDuration(30)).toBe('30 Min.');
    expect(formatDuration(90)).toBe('1 Std. 30 Min.');
    const now = new Date('2026-11-23T08:00:00Z'); // Monday
    expect(formatWhen('2026-11-23T12:00:00Z', 'Europe/Vienna', now)).toBe('heute, 13:00');
    expect(formatWhen('2026-11-24T08:30:00Z', 'Europe/Vienna', now)).toBe('morgen, 09:30');
  });

  it('accepts Austrian phone numbers', () => {
    expect(toE164('0664 123 4567')).toBe('+436641234567');
    expect(toE164('01 920 8295')).toBe('+4319208295');
    expect(toE164('0043 664 1234567')).toBe('+436641234567');
    expect(toE164('+43 1 9208295')).toBe('+4319208295');
    expect(formatPhone('+4319208295')).toBe('+43 1 920 8295');
    expect(formatPhone('+436641234567')).toBe('+43 664 123 4567');
    const r = personSchema.safeParse({name: 'M', phone: '12', comment: ''});
    expect(r.error!.issues.map(i => i.message)).toEqual(['Bitte Namen angeben', 'Telefon im Format +43 664 123 4567']);
  });

  it('translates server errors by code', () => {
    expect(toApiError({message: 'SLOT_TAKEN', hint: 'Это время только что заняли.'}).message).toBe('Diese Zeit ist bereits vergeben. Bitte wählen Sie eine andere.');
    expect(toApiError({message: 'SOMETHING_NEW', hint: 'по-русски'}).message).toBe('Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.');
  });

  it('names closed days in German', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(d => ({weekday: d, opens: '09:00', closes: '19:00'}));
    expect(summarizeHours(rows)).toEqual([
      {days: 'Mo–Sa', hours: '09:00–19:00', closed: false},
      {days: 'So', hours: 'Geschlossen', closed: true},
    ]);
  });

  it('a barbershop speaks of barbers', () => {
    setLang('de', 'beauty', 'barber');
    expect(msg.settings.tabs.bays).toBe('Barber');
    expect(msg.status.arrived).toBe('Kunde ist da');
    expect(beautyMsg().home.masters).toBe('Unsere Barber');
    expect(beautyMsg().flow.anyMaster).toBe('Egal welcher Barber frei ist');
    setLang('de');
  });
});

describe('German assistant without a model', () => {
  const TZ = 'Europe/Vienna';
  const NOW = new Date('2026-11-23T08:00:00Z'); // Monday 09:00 in Vienna
  const services = [
    {id: 'cut', name: 'Haarschnitt', category: 'Haare'},
    {id: 'beard', name: 'Bart Model Rasur', category: 'Bart'},
    {id: 'kids', name: 'Kinderhaarschnitt', category: 'Haare'},
  ];

  it('routes the example questions', () => {
    expect(routeClient('Wann ist der nächste freie Termin?', services, TZ, NOW, 'de')).toMatchObject({intent: 'clarify'});
    expect(routeClient('Was kostet ein Haarschnitt?', services, TZ, NOW, 'de')).toMatchObject({intent: 'price', serviceIds: expect.arrayContaining(['cut'])});
    expect(routeClient('Wo finde ich Sie?', services, TZ, NOW, 'de')).toEqual({intent: 'location'});
  });

  it('understands services and dates', () => {
    expect(routeClient('Habt ihr am Freitag einen Termin für Bart?', services, TZ, NOW, 'de')).toEqual({intent: 'nearest_slot', serviceId: 'beard', dateFrom: '2026-11-27'});
    expect(routeClient('Kinderhaarschnitt übermorgen frei?', services, TZ, NOW, 'de')).toEqual({intent: 'nearest_slot', serviceId: 'kids', dateFrom: '2026-11-25'});
    expect(routeClient('Bis wann habt ihr offen?', services, TZ, NOW, 'de')).toEqual({intent: 'hours'});
  });

  it('routes owner questions', () => {
    expect(routeOwner('Wer ist morgen gebucht?', TZ, NOW, 'de')).toEqual({intent: 'bookings', period: 'day', anchor: '2026-11-24'});
    expect(routeOwner('Wie viel Geld haben wir erhalten?', TZ, NOW, 'de')).toMatchObject({intent: 'stats', focus: 'money'});
  });

  it('writes template answers in German', async () => {
    expect(sp(money(20, 'EUR', 'de'))).toBe('€ 20');
    expect(when('2026-11-24T08:30:00Z', TZ, NOW, 'de')).toBe('morgen um 09:30');
    expect(duration(30, 'de')).toBe('30 Min.');
    const src: ClientSource = {
      tenant: {
        slug: 'demo-barber',
        name: 'Demo Barber',
        status: 'live',
        timezone: TZ,
        currency: 'EUR',
        locale: 'de-AT',
        phone: '+4319208295',
        address: 'Hauptstraße 1, 1100 Wien',
        map_url: null,
        services: services.map(s => ({...s, price: 20, price_from: false, duration_minutes: 30, description: ''})),
        hours: [{weekday: 1, opens: '09:00', closes: '19:00'}],
        exceptions: [],
        booking: {horizon_days: 30},
      },
      availability: async () => ({timezone: TZ, horizon_end: '2026-12-31', days: [{date: '2026-11-24', slots: [{start_at: '2026-11-24T08:30:00Z', available: true}]}]}),
    };
    const loc = await clientFallback(src, 'Wo finde ich Sie?');
    expect(loc.text).toContain('Sie finden uns hier: Hauptstraße 1, 1100 Wien');
    expect(loc.text).toContain('+43 1 920 8295');
    const slot = await clientFallback(src, 'Gibt es einen freien Termin für Bart?');
    expect(slot.text).toMatch(/^Nächste freie Termine für „Bart Model Rasur“: .+ um 09:30/);
    const stats = {
      period: 'day' as const,
      from_date: '2026-11-23',
      to_date: '2026-11-23',
      from_at: '',
      to_at: '',
      bookings: 5,
      cancelled: 0,
      no_show: 0,
      arrivals: 4,
      completed: 4,
      received: 95,
      refunded: 0,
      net_received: 95,
      expected_value: 120,
    };
    const owner = await ownerFallback(
      {timezone: TZ, currency: 'EUR', studioName: 'Demo', lang: 'de', stats: async () => stats, bookings: async () => []},
      'Wie viel Geld haben wir erhalten?',
    );
    expect(sp(owner.text)).toContain('Heute: erhalten € 95.');
  });
});
