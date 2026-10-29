import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {businessSchema} from '../../shared/business.ts';
import {setLang} from '../../src/i18n/index.ts';
import {daysLabel, washMsg} from '../../src/i18n/wash.ts';
import {toApiError} from '../../src/lib/errors.ts';
import {clientFallback, clientSystemPrompt, type ClientSource, type PublicTenant} from '../../supabase/functions/_shared/client-domain.ts';
import {washFallbackAnswer, washQuoteTool} from '../../supabase/functions/_shared/wash-assistant.ts';
import {validateCall} from '../../supabase/functions/_shared/tools.ts';
import {
  classOfText,
  cleanExtras,
  extrasOfText,
  peakAt,
  programFor,
  programRange,
  washLabelFor,
  washQuote,
  type PeakRule,
  type WashConfig,
} from '../../supabase/functions/_shared/wash.ts';

const sp = (s: string) => s.replace(/\s/g, ' ');
const raw = JSON.parse(readFileSync('tenants/myti-ukazka/business.json', 'utf8'));
const config = businessSchema.parse(raw);
const wash = config.wash! as WashConfig;
const program = (key: string) => programFor(wash, key)!;

describe('wash price list', () => {
  it('prices a program by car class (TopMytí / Klimš structure)', () => {
    expect(washQuote(wash, program('venkovni'), {class: 'medium', extras: []}, 45)).toEqual({price: 800, onRequest: false, durationMinutes: 60});
    expect(washQuote(wash, program('kompletni'), {class: 'medium', extras: []}, 70)).toEqual({price: 1560, onRequest: false, durationMinutes: 75});
    expect(washQuote(wash, program('venkovni'), {class: 'small', extras: []}, 45).price).toBe(700);
  });

  it('adds extras for the same class, time rounded up to 5 minutes', () => {
    expect(washQuote(wash, program('kompletni'), {class: 'suv', extras: ['vosk']}, 70)).toEqual({price: 3600, onRequest: false, durationMinutes: 195});
    expect(washQuote(wash, program('venkovni'), {class: 'small', extras: ['vosk', 'kola', 'okna']}, 45)).toEqual({price: 3500, onRequest: false, durationMinutes: 205});
  });

  it('ignores unknown, repeated and not-offered extras', () => {
    // «ozon» is not offered with the exterior wash; «nope» does not exist.
    expect(cleanExtras(wash, 'venkovni', ['ozon', 'nope', 'vosk', 'vosk']).map(e => e.key)).toEqual(['vosk']);
    expect(washQuote(wash, program('venkovni'), {class: 'medium', extras: ['ozon', 'nope']}, 45).price).toBe(800);
  });

  it('says «on request» when the class or a chosen extra has no price', () => {
    expect(washQuote(wash, program('interier'), {class: 'van', extras: []}, 60)).toEqual({price: 0, onRequest: true, durationMinutes: 90});
    expect(washQuote(wash, program('venkovni'), {class: 'van', extras: ['motor']}, 45)).toEqual({price: 0, onRequest: true, durationMinutes: 140});
    const partial = {...wash, programs: [{service: 'x', prices: {small: {price: 100, minutes: 10}}}]};
    expect(washQuote(partial, partial.programs[0]!, {class: 'suv', extras: []}, 50)).toEqual({price: 0, onRequest: true, durationMinutes: 50});
  });

  it('names the booking and summarises ranges', () => {
    expect(washLabelFor('Kompletní mytí', 'kompletni', wash, {class: 'suv', extras: ['ozon', 'vosk']})).toBe('Kompletní mytí — SUV / MPV + Tvrdý vosk, Ozon – dezinfekce a pachy');
    expect(programRange(program('interier'))).toEqual({min: 1000, max: 1400, onRequest: true});
  });
});

describe('wash business.json', () => {
  it('validates the Czech demo', () => {
    expect(config.kind).toBe('carwash');
    expect(config.booking.slotStepMinutes).toBe(15);
    expect(config.booking.peakHours).toHaveLength(2);
    expect(wash.plateRequired).toBe(true);
  });

  it('requires a price list for a car wash and known services in it', () => {
    expect(businessSchema.safeParse({...raw, wash: undefined}).success).toBe(false);
    const bad = businessSchema.safeParse({...raw, wash: {...raw.wash, extras: [{key: 'x', name: 'Xx', prices: {}, programs: ['nope']}]}});
    expect(bad.error?.issues.some(i => i.message.includes('nope'))).toBe(true);
    const dup = businessSchema.safeParse({...raw, wash: {...raw.wash, extras: [raw.wash.extras[0], raw.wash.extras[0]]}});
    expect(dup.success).toBe(false);
    const badPeak = businessSchema.safeParse({...raw, booking: {...raw.booking, peakHours: [{days: [1], from: '12:00', to: '10:00', mode: 'walkin'}]}});
    expect(badPeak.success).toBe(false);
    const limitNoPosts = businessSchema.safeParse({...raw, booking: {...raw.booking, peakHours: [{days: [1], from: '10:00', to: '12:00', mode: 'limit'}]}});
    expect(limitNoPosts.success).toBe(false);
  });

  it('leaves other studios as they were', () => {
    const jh = businessSchema.parse(JSON.parse(readFileSync('tenants/jh-auto-detailing/business.json', 'utf8')));
    expect(jh.wash).toBeUndefined();
    expect(jh.booking.peakHours).toBeUndefined();
  });
});

describe('peak hours (slot rules)', () => {
  const rules: PeakRule[] = [
    {days: [6], from: '08:00', to: '12:00', mode: 'walkin'},
    {days: [5], from: '15:00', to: '18:00', mode: 'limit', posts: 1},
  ];
  it('picks the rule by weekday and start time, end exclusive', () => {
    expect(peakAt(rules, 6, '08:00')?.mode).toBe('walkin');
    expect(peakAt(rules, 6, '11:45')?.mode).toBe('walkin');
    expect(peakAt(rules, 6, '12:00')).toBeNull();
    expect(peakAt(rules, 5, '15:30')).toMatchObject({mode: 'limit', posts: 1});
    expect(peakAt(rules, 4, '15:30')).toBeNull();
  });
});

describe('assistant and the wash price list', () => {
  const services = config.services.map((s, i) => ({
    id: `00000000-0000-4000-8000-00000000001${i}`,
    key: s.key,
    name: s.name,
    category: s.category,
    price: s.price,
    price_from: s.priceFrom,
    duration_minutes: s.durationMinutes,
    description: s.description,
  }));
  const tenant: PublicTenant = {
    slug: 'myti-ukazka',
    name: config.name,
    status: 'preview',
    timezone: 'Europe/Prague',
    currency: 'CZK',
    locale: 'cs-CZ',
    phone: '+420000000000',
    address: config.contacts.address,
    map_url: null,
    services,
    hours: [],
    exceptions: [],
    booking: {horizon_days: 21},
    faq: config.faq,
    wash,
  };
  const src: ClientSource = {tenant, availability: async () => ({timezone: 'Europe/Prague', days: [], horizon_end: '2026-12-01T00:00:00Z'})};

  it('reads the class and extras from a question', () => {
    expect(classOfText('Kolik stojí kompletní mytí SUV s voskem?')).toBe('suv');
    expect(classOfText('Ile kosztuje mycie busa?')).toBe('van');
    expect(classOfText('Сколько стоит мойка седана?')).toBe('medium');
    expect(extrasOfText('Kolik stojí kompletní mytí SUV s voskem?', wash.extras, services.map(s => s.name))).toEqual(['vosk']);
    expect(extrasOfText('mytí s voskem a ozonem', wash.extras, services.map(s => s.name))).toEqual(['vosk', 'ozon']);
  });

  it('answers «Kolik stojí kompletní mytí SUV s voskem?» without a model', async () => {
    const r = await clientFallback(src, 'Kolik stojí kompletní mytí SUV s voskem?');
    expect(r.tools).toEqual(['quote_wash']);
    expect(sp(r.text)).toContain('Kompletní mytí — SUV / MPV + Tvrdý vosk: 3 600 Kč, cca 3 h 15 min.');
  });

  it('lists the classes when the size is missing and says «on request» honestly', () => {
    const r = washFallbackAnswer(tenant, 'Kolik stojí čištění interiéru?', 'cs')!;
    expect(sp(r.text)).toContain('Čištění interiéru — Malé: 1 000 Kč');
    expect(r.text).toContain('Čištění interiéru — Dodávka: cena na dotaz');
  });

  it('leaves other questions to the usual router', async () => {
    expect(washFallbackAnswer(tenant, 'Kde vás najdu?', 'cs')).toBeNull();
    expect((await clientFallback(src, 'Můžu přijet bez objednání?')).tools).toEqual([]);
    expect(washFallbackAnswer({...tenant, wash: null}, 'Kolik stojí kompletní mytí SUV?', 'cs')).toBeNull();
  });

  it('gives the model a validated quote_wash tool and tells it to use it', () => {
    expect(validateCall('client', 'quote_wash', {class: 'suv', extras: ['vosk']}).ok).toBe(true);
    expect(validateCall('client', 'quote_wash', {class: 'truck'}).ok).toBe(false);
    const q = washQuoteTool(tenant, {service_id: services[1]!.id, class: 'suv', extras: ['vosk']}) as {quotes: {price: number}[]};
    expect(q.quotes).toEqual([expect.objectContaining({price: 3600, on_request: false, duration_minutes: 195})]);
    expect(clientSystemPrompt(tenant, '2026-10-30')).toContain('quote_wash');
    expect(clientSystemPrompt({...tenant, wash: null}, '2026-10-30')).not.toContain('quote_wash');
  });
});

describe('wash interface texts', () => {
  beforeAll(() => setLang('cs'));
  afterAll(() => setLang('ru'));
  it('translates the new server error codes and labels days', () => {
    expect(toApiError({message: 'ONLINE_CLOSED', hint: '…'}).message).toBe(washMsg().errors.ONLINE_CLOSED);
    expect(washMsg().passes.left(3, 10)).toBe('zbývá 3 z 10');
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('po–pá');
    expect(daysLabel([6])).toBe('so');
  });
});
