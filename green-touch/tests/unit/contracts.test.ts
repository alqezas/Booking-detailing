import {describe, expect, it} from 'vitest';
import {
  PRICE_BANDS,
  catalogParams,
  checkoutRequestSchema,
  formatUah,
  kitDiscountKop,
  normalizeUaPhone,
  parseCatalogParams,
  priceBounds,
} from '../../supabase/functions/_shared/contracts.ts';

describe('kit discount (same rule as private.discount_kop)', () => {
  it('rounds half up to a kopeck and is applied once', () => {
    expect(kitDiscountKop(160000, 1500)).toBe(24000);
    expect(kitDiscountKop(33333, 1500)).toBe(5000); // 4999.95 → 5000
    expect(kitDiscountKop(33329, 1500)).toBe(4999); // 4999.35 → 4999
    expect(kitDiscountKop(33331, 1500)).toBe(5000); // 4999.65 → 5000
  });
});

describe('price bands', () => {
  it('are disjoint whole-kopeck intervals covering everything, kits above 1500 included', () => {
    for (let i = 1; i < PRICE_BANDS.length; i++) expect(PRICE_BANDS[i]!.min).toBe(PRICE_BANDS[i - 1]!.max! + 1);
    expect(PRICE_BANDS.at(-1)!.max).toBeNull();
    expect(priceBounds({band: '500-1000'})).toEqual({minKop: 50000, maxKop: 99999});
    expect(priceBounds({min: 400, max: 500})).toEqual({minKop: 40000, maxKop: 50000});
  });
});

describe('catalog URL state', () => {
  it('round-trips and drops invalid values instead of failing', () => {
    const q = parseCatalogParams(new URLSearchParams('kategoriia=kremy&typ=chutlyva,sukha&potreba=zmorshky&sort=price_asc&storinka=2'));
    expect(q).toMatchObject({category: 'kremy', skin: ['chutlyva', 'sukha'], need: ['zmorshky'], sort: 'price_asc', page: 2});
    expect(catalogParams(q).toString()).toBe('kategoriia=kremy&typ=chutlyva%2Csukha&potreba=zmorshky&sort=price_asc&storinka=2');
    expect(parseCatalogParams(new URLSearchParams('sort=hack&kategoriia=../x'))).toMatchObject({sort: 'popular', category: null});
  });
});

describe('checkout validation', () => {
  it('normalizes Ukrainian phones', () => {
    expect(normalizeUaPhone('067 123 45 67')).toBe('+380671234567');
    expect(normalizeUaPhone('+38 (067) 123-45-67')).toBe('+380671234567');
    expect(normalizeUaPhone('12345')).toBeNull();
  });
  it('accepts ids and quantities only; a price field is ignored', () => {
    const r = checkoutRequestSchema.safeParse({
      idempotency_key: 'abcdefghijklmnop',
      payment_method: 'prepay_manual',
      lines: [{id: '00000000-0000-4000-8000-000000000001', qty: 1, price_kop: 1}],
      customer: {first_name: 'Олена', last_name: 'Петренко-Коваль', phone: '0671234567'},
      delivery: {method: 'np_branch', settlement_ref: '00000000-0000-4000-8000-000000000001', city_ref: '00000000-0000-4000-8000-000000000002', warehouse_ref: '00000000-0000-4000-8000-000000000003'},
      consent: true,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.lines[0]).toEqual({id: '00000000-0000-4000-8000-000000000001', qty: 1});
  });
});

describe('formatUah', () => {
  it('groups thousands and shows kopecks only when present', () => {
    expect(formatUah(136000)).toBe('1 360 грн');
    expect(formatUah(28333)).toBe('283,33 грн');
  });
});
