import {describe, expect, it} from 'vitest';
import {businessSchema, findPlaceholders} from '../../shared/business.ts';
import {accentPair, contrast} from '../../shared/color.ts';
import {configMediaUrl, mediaFileName, resolveMediaUrl} from '../../shared/media.ts';
import {buildIcs} from '../../src/lib/ics.ts';
import {formatDuration, formatPrice, summarizeHours} from '../../src/lib/format.ts';
import {customerSchema, toE164} from '../../src/lib/schemas.ts';
import {readFileSync} from 'node:fs';

describe('accent colours stay readable', () => {
  it.each(['#4690FF', '#FF8A3D', '#FFE000', '#00C2A8', '#7A00FF'])('%s', hex => {
    const {fill, text, onFill} = accentPair(hex);
    expect(contrast(fill, onFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, '#000000')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('customer input', () => {
  it('normalises Russian phone formats', () => {
    expect(toE164('8 (999) 123-45-67')).toBe('+79991234567');
    expect(toE164('9991234567')).toBe('+79991234567');
    expect(toE164('+7 999 123 45 67')).toBe('+79991234567');
  });
  it('validates required fields with readable messages', () => {
    const r = customerSchema.safeParse({name: 'А', phone: '123', car: '', comment: ''});
    expect(r.success).toBe(false);
    expect(r.error!.issues.map(i => i.message)).toEqual(['Укажите имя', 'Телефон в формате +7 999 123-45-67', 'Укажите марку и модель']);
  });
});

describe('formatting', () => {
  it('durations and prices', () => {
    expect(formatDuration(90)).toBe('1 ч 30 мин');
    expect(formatDuration(1980)).toBe('2 дня');
    expect(formatPrice(18000, true).replace(/\s/g, ' ')).toBe('от 18 000 ₽');
  });
  it('groups equal working days', () => {
    const rows = [1, 2, 3, 4, 5].map(d => ({weekday: d, opens: '09:00', closes: '21:00'})).concat({weekday: 6, opens: '10:00', closes: '18:00'});
    expect(summarizeHours(rows)).toEqual([
      {days: 'Пн–Пт', hours: '09:00–21:00'},
      {days: 'Сб', hours: '10:00–18:00'},
      {days: 'Вс', hours: 'Выходной'},
    ]);
  });
});

describe('calendar file', () => {
  it('is valid ICS with a 24h alarm and escaped text', () => {
    const ics = buildIcs(
      {uid: 'b1@x', title: 'Мойка, полировка; тест', start: '2026-10-17T07:00:00Z', end: '2026-10-17T09:00:00Z', location: 'Москва', description: 'line1\nline2'},
      new Date('2026-10-16T00:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20261017T070000Z');
    expect(ics).toContain('TRIGGER:-PT24H');
    expect(ics).toContain('SUMMARY:Мойка\\, полировка\\; тест');
    expect(ics).toContain('DESCRIPTION:line1\\nline2');
    expect(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe('media paths', () => {
  it('maps config images to site URLs and uploads to storage', () => {
    expect(mediaFileName('images/Work 1.JPG')).toBe('work-1.webp');
    expect(mediaFileName('images/logo.png')).toBe('logo.png');
    expect(configMediaUrl('graphite', 'images/hero.webp')).toBe('/s/graphite/media/hero.webp');
    expect(resolveMediaUrl('abc/hero.webp', 'https://x.supabase.co')).toBe('https://x.supabase.co/storage/v1/object/public/tenant-media/abc/hero.webp');
  });
});

describe('business.json', () => {
  it('both demo studios validate and have no placeholders', () => {
    for (const slug of ['graphite', 'severny']) {
      const c = businessSchema.parse(JSON.parse(readFileSync(`tenants/${slug}/business.json`, 'utf8')));
      expect(findPlaceholders(c)).toEqual([]);
    }
  });
  it('the scaffold template is flagged as placeholder', () => {
    const t = JSON.parse(readFileSync('scripts/templates/detailing.json', 'utf8'));
    const c = businessSchema.parse({...t, slug: 'new-one', name: 'Новая студия'});
    expect(findPlaceholders(c)).toEqual(['contacts.phone', 'owner.email', 'contacts.address']);
  });
  it('rejects a service bound to an unknown bay', () => {
    const c = JSON.parse(readFileSync('tenants/graphite/business.json', 'utf8'));
    c.services[0].resources = ['nope'];
    expect(businessSchema.safeParse(c).success).toBe(false);
  });
});
