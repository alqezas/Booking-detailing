import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {businessSchema} from '../../shared/business.ts';
import {setLang} from '../../src/i18n/index.ts';
import {tireMsg} from '../../src/i18n/tire.ts';
import {toApiError} from '../../src/lib/errors.ts';
import {clientFallback, clientSystemPrompt, type ClientSource, type PublicTenant} from '../../supabase/functions/_shared/client-domain.ts';
import {tireFallbackAnswer, tireQuoteTool} from '../../supabase/functions/_shared/tire-assistant.ts';
import {validateCall} from '../../supabase/functions/_shared/tools.ts';
import {
  currentOrNextSeason,
  diameterOfSize,
  effectiveHorizon,
  looksLikeTireQuestion,
  matchRow,
  normalizePlate,
  parseDayMonth,
  parseTireQuestion,
  priceRange,
  quote,
  quoteLabel,
  seasonOn,
  type SeasonPeriod,
  type TireOperation,
} from '../../supabase/functions/_shared/tire.ts';

const sp = (s: string) => s.replace(/\s/g, ' ');
const raw = JSON.parse(readFileSync('tenants/pneuservis-ukazka/business.json', 'utf8'));
const config = businessSchema.parse(raw);
const tire = config.tire!;
const op = (key: string) => tire.operations.find(o => o.service === key)! as TireOperation;

describe('tyre price matrix', () => {
  it('prices a set by vehicle, rims and diameter (R8 Performance structure)', () => {
    expect(quote(op('prezuti-kol'), {vehicle: 'car', rim: 'steel', diameter: 15, wheels: 4}, 45)).toEqual({price: 550, onRequest: false, durationMinutes: 45, wheels: 4});
    expect(quote(op('prezuti-kol'), {vehicle: 'car', rim: 'alloy', diameter: 18, wheels: 4}, 45).price).toBe(650);
    expect(quote(op('prezuti-kol'), {vehicle: 'suv', rim: 'alloy', diameter: 17, wheels: 4}, 45)).toEqual({price: 750, onRequest: false, durationMinutes: 60, wheels: 4});
    expect(quote(op('disk-na-disk'), {vehicle: 'car', rim: 'alloy', diameter: 16, wheels: 4}, 60).price).toBe(850);
    expect(quote(op('disk-na-disk'), {vehicle: 'car', rim: 'alloy', diameter: 17, wheels: 4}, 60).price).toBe(1100);
  });

  it('scales a set price and time with the number of wheels', () => {
    // 650 × 2 / 4 = 325; 45 min × 2 / 4 = 22.5 → rounded up to 25.
    expect(quote(op('prezuti-kol'), {vehicle: 'car', rim: 'alloy', diameter: 16, wheels: 2}, 45)).toEqual({price: 325, onRequest: false, durationMinutes: 25, wheels: 2});
    // 550 × 1 / 4 = 137.5 → 138; the shortest job is 15 minutes.
    expect(quote(op('prezuti-kol'), {vehicle: 'car', rim: 'steel', diameter: 16, wheels: 1}, 45)).toMatchObject({price: 138, durationMinutes: 15});
    expect(quote(op('prezuti-kol'), {vehicle: 'van', rim: 'steel', diameter: 16, wheels: 6}, 45)).toMatchObject({price: 1125, durationMinutes: 90});
    // Out of range is clamped: 0 → 4 wheels, 20 → 8.
    expect(quote(op('vyvazeni'), {vehicle: 'car', rim: 'steel', diameter: 15, wheels: 0}, 30).wheels).toBe(4);
    expect(quote(op('vyvazeni'), {vehicle: 'car', rim: 'steel', diameter: 15, wheels: 20}, 30).wheels).toBe(8);
  });

  it('keeps a «job» price fixed', () => {
    expect(quote(op('defekt'), {vehicle: 'car', rim: 'alloy', diameter: 17, wheels: 1}, 30)).toEqual({price: 500, onRequest: false, durationMinutes: 30, wheels: 1});
    expect(quote(op('uskladneni'), {vehicle: 'suv', rim: 'alloy', diameter: 19, wheels: 4}, 15).price).toBe(1000);
  });

  it('says «on request» for a null row and for no matching row', () => {
    expect(quote(op('prezuti-kol'), {vehicle: 'van', rim: 'alloy', diameter: 21, wheels: 4}, 45)).toEqual({price: 0, onRequest: true, durationMinutes: 75, wheels: 4});
    expect(quote(op('defekt'), {vehicle: 'van', rim: 'steel', diameter: 16, wheels: 1}, 30)).toMatchObject({price: 0, onRequest: true, durationMinutes: 45});
    const narrow: TireOperation = {service: 'x', unit: 'set', rows: [{vehicles: ['car'], from: 13, to: 16, price: 400, minutes: 30}]};
    expect(quote(narrow, {vehicle: 'suv', rim: 'steel', diameter: 15, wheels: 4}, 50)).toEqual({price: 0, onRequest: true, durationMinutes: 50, wheels: 4});
  });

  it('takes the first matching row', () => {
    expect(matchRow(op('disk-na-disk'), {vehicle: 'suv', rim: 'steel', diameter: 22})).toMatchObject({price: null});
    expect(matchRow(op('disk-na-disk'), {vehicle: 'suv', rim: 'steel', diameter: 21})).toMatchObject({price: 1300});
  });

  it('names the booking and summarises ranges', () => {
    expect(quoteLabel('Přezutí kompletních kol + vyvážení', op('prezuti-kol'), {vehicle: 'suv', rim: 'alloy', diameter: 17, wheels: 4}, tire.names)).toBe(
      'Přezutí kompletních kol + vyvážení — SUV / 4×4, Alu R17, 4×',
    );
    expect(quoteLabel('Oprava defektu', op('defekt'), {vehicle: 'car', rim: 'steel', diameter: 22, wheels: 1}, tire.names)).toBe('Oprava defektu — Osobní, Plech R22+');
    expect(priceRange(op('disk-na-disk'), 'car', 'alloy')).toEqual({min: 850, max: 1100, onRequest: true});
    expect(priceRange(op('prezuti-kol'), 'van', 'steel')).toEqual({min: 750, max: 750, onRequest: true});
  });
});

describe('tyre business.json', () => {
  it('validates the Czech demo', () => {
    expect(config.kind).toBe('tireservice');
    expect(config.locale).toBe('cs-CZ');
    expect(config.booking.slotStepMinutes).toBe(15);
    expect(config.resources.filter(r => r.seasonal).map(r => r.key)).toEqual(['zvedak-3']);
    for (const o of tire.operations) expect(config.services.some(s => s.key === o.service)).toBe(true);
  });

  it('requires the matrix for a tyre service and known services in it', () => {
    const noTire = businessSchema.safeParse({...raw, tire: undefined});
    expect(noTire.success).toBe(false);
    const badOp = businessSchema.safeParse({...raw, tire: {...raw.tire, operations: [{service: 'nope', unit: 'set', rows: [{from: 13, to: 22, price: 1, minutes: 10}]}]}});
    expect(badOp.error?.issues.some(i => i.message.includes('nope'))).toBe(true);
    const badRange = businessSchema.safeParse({...raw, tire: {...raw.tire, operations: [{service: 'defekt', rows: [{from: 19, to: 15, price: 1, minutes: 10}]}]}});
    expect(badRange.success).toBe(false);
    const badSeason = businessSchema.safeParse({...raw, tire: {...raw.tire, seasons: [{from: '13-01', to: '11-30', mount: 'winter'}]}});
    expect(badSeason.success).toBe(false);
  });

  it('leaves detailing studios as they were', () => {
    const jh = businessSchema.parse(JSON.parse(readFileSync('tenants/jh-auto-detailing/business.json', 'utf8')));
    expect(jh.kind).toBe('detailing');
    expect(jh.tire).toBeUndefined();
  });
});

describe('seasons and booking horizon', () => {
  const seasons: SeasonPeriod[] = [
    {from: '10-15', to: '11-30', mount: 'winter', horizonDays: 14},
    {from: '03-15', to: '04-30', mount: 'summer'},
  ];
  it('finds the season of a date, including periods across the new year', () => {
    expect(seasonOn(seasons, '2026-10-28')?.mount).toBe('winter');
    expect(seasonOn(seasons, '2026-10-14')).toBeNull();
    expect(seasonOn(seasons, '2027-04-30')?.mount).toBe('summer');
    const wrap: SeasonPeriod[] = [{from: '12-01', to: '02-28', mount: 'winter'}];
    expect(seasonOn(wrap, '2026-12-31')).not.toBeNull();
    expect(seasonOn(wrap, '2027-01-15')).not.toBeNull();
    expect(seasonOn(wrap, '2027-03-01')).toBeNull();
  });

  it('shortens the horizon only while a season with its own horizon runs', () => {
    expect(effectiveHorizon(30, seasons, '2026-10-28')).toBe(14);
    expect(effectiveHorizon(10, seasons, '2026-10-28')).toBe(10);
    expect(effectiveHorizon(30, seasons, '2027-04-01')).toBe(30); // summer season without its own horizon
    expect(effectiveHorizon(30, seasons, '2027-01-10')).toBe(30);
  });

  it('knows the running and the next season', () => {
    expect(currentOrNextSeason(seasons, '2026-10-28')).toMatchObject({start: '2026-10-15', end: '2026-11-30', startsInDays: 0});
    expect(currentOrNextSeason(seasons, '2027-01-10')).toMatchObject({start: '2027-03-15', end: '2027-04-30', startsInDays: 64});
    expect(currentOrNextSeason([], '2027-01-10')).toBeNull();
  });

  it('reads «DD.MM» typed by the owner', () => {
    expect(parseDayMonth('15.10')).toBe('10-15');
    expect(parseDayMonth(' 1. 3. ')).toBe('03-01');
    expect(parseDayMonth('31/12')).toBe('12-31');
    expect(parseDayMonth('15.13')).toBeNull();
    expect(parseDayMonth('abc')).toBeNull();
  });
});

describe('customer data', () => {
  it('normalises plates and reads the diameter from a tyre size', () => {
    expect(normalizePlate('1t2 3456')).toBe('1T23456');
    expect(normalizePlate('KR-12345')).toBe('KR12345');
    expect(diameterOfSize('205/55 R16 91V')).toBe(16);
    expect(diameterOfSize('235/45ZR18')).toBe(18);
    expect(diameterOfSize('R24')).toBe(22);
    expect(diameterOfSize('nevím')).toBeNull();
  });
});

describe('assistant and the matrix', () => {
  const services = config.services.map((s, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    key: s.key,
    name: s.name,
    category: s.category,
    price: s.price,
    price_from: s.priceFrom,
    duration_minutes: s.durationMinutes,
    description: s.description,
  }));
  const tenant: PublicTenant = {
    slug: 'pneuservis-ukazka',
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
    booking: {horizon_days: 30},
    faq: config.faq,
    tire,
  };
  const src: ClientSource = {tenant, availability: async () => ({timezone: 'Europe/Prague', days: [], horizon_end: '2026-12-01T00:00:00Z'})};

  it('parses vehicle, rims, diameter and wheels from a question', () => {
    expect(parseTireQuestion('Kolik stojí přezutí alu R17 na SUV?')).toEqual({vehicle: 'suv', rim: 'alloy', diameter: 17});
    expect(parseTireQuestion('Сколько стоит переобувка литых R16 на легковую?')).toEqual({vehicle: 'car', rim: 'alloy', diameter: 16});
    expect(parseTireQuestion('Ile kosztuje wymiana stalowych 15" w busie, 6 kół?')).toEqual({vehicle: 'van', rim: 'steel', diameter: 15, wheels: 6});
    expect(looksLikeTireQuestion('Kolik stojí přezutí alu R17 na SUV?')).toBe(true);
    expect(looksLikeTireQuestion('Kolik stojí čištění interiéru?')).toBe(false);
    expect(looksLikeTireQuestion('Kde vás najdu?')).toBe(false);
  });

  it('answers «Kolik stojí přezutí alu R17 na SUV?» from the matrix without a model', async () => {
    const r = await clientFallback(src, 'Kolik stojí přezutí alu R17 na SUV?');
    expect(r.tools).toEqual(['quote_tire']);
    expect(sp(r.text)).toContain('Přezutí kompletních kol + vyvážení — SUV / 4×4, Alu R17, 4×: 750 Kč, cca 1 h.');
  });

  it('lists ranges when the diameter is missing and says «on request» honestly', () => {
    const ranges = tireFallbackAnswer(tenant, 'Kolik stojí přezutí z disku na disk na dodávku?', 'cs')!;
    expect(sp(ranges.text)).toContain('Přezutí pneu z disku na disk — Dodávka');
    const onRequest = tireFallbackAnswer(tenant, 'Kolik stojí přezutí alu R21 na dodávku?', 'cs')!;
    expect(onRequest.text).toContain('cena na dotaz');
  });

  it('leaves other questions to the usual router', async () => {
    expect(tireFallbackAnswer(tenant, 'Kde vás najdu?', 'cs')).toBeNull();
    expect(tireFallbackAnswer(tenant, 'Kdy máte volno na přezutí?', 'cs')).toBeNull();
    expect((await clientFallback(src, 'Kde vás najdu?')).tools).toEqual(['get_studio_info']);
    expect(tireFallbackAnswer({...tenant, tire: null}, 'Kolik stojí přezutí alu R17 na SUV?', 'cs')).toBeNull();
  });

  it('gives the model a validated quote_tire tool and tells it to use it', () => {
    expect(validateCall('client', 'quote_tire', {vehicle: 'suv', rim: 'alloy', diameter: 17}).ok).toBe(true);
    expect(validateCall('client', 'quote_tire', {vehicle: 'truck'}).ok).toBe(false);
    expect(validateCall('owner', 'quote_tire', {}).ok).toBe(false);
    const q = tireQuoteTool(tenant, {service_id: services[0]!.id, vehicle: 'suv', rim: 'alloy', diameter: 17}) as {quotes: {price: number; on_request: boolean}[]};
    expect(q.quotes).toEqual([expect.objectContaining({price: 750, on_request: false, duration_minutes: 60})]);
    expect(clientSystemPrompt(tenant, '2026-10-28')).toContain('quote_tire');
    expect(clientSystemPrompt({...tenant, tire: null}, '2026-10-28')).not.toContain('quote_tire');
  });
});

describe('tyre interface texts', () => {
  beforeAll(() => setLang('cs'));
  afterAll(() => setLang('ru'));
  it('translates the new server error codes', () => {
    expect(toApiError({message: 'INVALID_PLATE', hint: 'Укажите госномер (SPZ)'}).message).toBe('Zadejte SPZ');
    expect(toApiError({message: 'NO_FREE_SLOT', hint: '…'}).message).toBe(tireMsg().errors.NO_FREE_SLOT);
    expect(tireMsg().calc.forWheels(4)).toBe('za 4 kola');
    expect(tireMsg().calc.diameterLabel(22)).toBe('R22 a více');
  });
});
