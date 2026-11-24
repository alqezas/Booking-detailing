import {afterAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {businessSchema, type BusinessConfig} from '../../shared/business.ts';
import {accentPairLight, contrast} from '../../shared/color.ts';
import {msg, setLang, setPhoneCountry} from '../../src/i18n/index.ts';
import {beautyMsg} from '../../src/i18n/beauty.ts';
import {openState} from '../../src/lib/beauty.ts';
import {toE164} from '../../src/lib/schemas.ts';
import {addonsQuote, normaliseAddons} from '../../supabase/functions/_shared/beauty.ts';
import {addonsOfText, beautyFallbackAnswer, beautyQuoteTool, freeSlotsAnswer, mastersList} from '../../supabase/functions/_shared/beauty-assistant.ts';
import {clientFallback, clientSystemPrompt, type ClientSource, type PublicTenant} from '../../supabase/functions/_shared/client-domain.ts';
import {ownerFallback, ownerExecutor, type OwnerSource} from '../../supabase/functions/_shared/owner-domain.ts';
import {telegramOutcome, telegramText} from '../../supabase/functions/_shared/telegram.ts';
import {validateCall} from '../../supabase/functions/_shared/tools.ts';

const load = (slug: string): BusinessConfig => businessSchema.parse(JSON.parse(readFileSync(`tenants/${slug}/business.json`, 'utf8')));
const aura = load('aura-beauty');
const velvet = load('velvet-spa');

/** The public card shape (public_get_tenant) built from a business.json. */
function card(c: BusinessConfig): PublicTenant & {currency: string} {
  return {
    slug: c.slug,
    kind: c.kind,
    name: c.name,
    status: 'preview',
    timezone: c.timezone,
    currency: c.currency,
    locale: c.locale,
    phone: c.contacts.phone,
    address: c.contacts.address,
    map_url: c.contacts.mapUrl ?? null,
    services: c.services.map(s => ({
      id: `00000000-0000-4000-8000-${String(c.services.indexOf(s)).padStart(12, '0')}`,
      key: s.key,
      name: s.name,
      category: s.category,
      price: s.price,
      price_from: s.priceFrom,
      duration_minutes: s.durationMinutes,
      description: s.description,
      addons: (s.addons ?? []).map(a => ({key: a.key, name: a.name, price: a.price, duration_minutes: a.minutes})),
      resource_ids: s.resources,
    })),
    resources: c.resources.map(r => ({id: r.key, name: r.name, role: r.role ?? 'place', title: r.title ?? ''})),
    hours: [],
    exceptions: [],
    booking: {horizon_days: c.booking.horizonDays},
    faq: c.faq,
  };
}

afterAll(() => setLang('ru'));

describe('business.json of beauty studios', () => {
  it('both demo studios validate; the solo studio has one master', () => {
    expect(aura.kind).toBe('beauty');
    expect(aura.resources.filter(r => r.role === 'master')).toHaveLength(2);
    expect(velvet.resources.filter(r => r.role === 'master')).toHaveLength(1);
    expect(aura.accentColor).not.toBe(velvet.accentColor);
    expect(aura.locale).not.toBe(velvet.locale);
  });

  it('rejects a master shift outside the studio hours, duplicate option keys and add-ons on a car studio', () => {
    const raw = JSON.parse(readFileSync('tenants/aura-beauty/business.json', 'utf8'));
    raw.resources[1].hours.tue = [['08:00', '20:00']];
    raw.services.find((s: {key: string}) => s.key === 'manicure-gel').addons.push({key: 'removal', name: 'Again', price: 1});
    const r = businessSchema.safeParse(raw);
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map(i => i.message).join('\n');
    expect(messages).toMatch(/выходит за часы студии/);
    expect(messages).toMatch(/Повтор ключа опции/);
    const car = JSON.parse(readFileSync('tenants/aura-beauty/business.json', 'utf8'));
    car.kind = 'detailing';
    expect(businessSchema.safeParse(car).error?.issues.some(i => /addons/.test(i.message))).toBe(true);
  });
});

describe('add-on quote (mirror of private.addons_quote)', () => {
  const mani = card(aura).services.find(s => s.key === 'manicure-gel')!;
  it('sums price and minutes, ignores duplicates, reports unknown keys', () => {
    const q = addonsQuote(mani, ['strengthen', 'removal', 'removal']);
    expect(q.price).toBe(750 + 100 + 150);
    expect(q.duration_minutes).toBe(90 + 15 + 15);
    expect(q.addons.map(a => a.key)).toEqual(['removal', 'strengthen']);
    expect(addonsQuote(mani, ['gold']).unknown).toEqual(['gold']);
    expect(normaliseAddons(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('client assistant (no model): answers from studio data', () => {
  const t = card(aura);
  const src: ClientSource = {tenant: t, availability: async () => ({timezone: t.timezone, horizon_end: '2099-01-01', days: []})};

  it('«Сколько стоит маникюр со снятием?» → service price + removal option', async () => {
    const r = await clientFallback(src, 'Сколько стоит маникюр со снятием?');
    expect(r.tools).toEqual(['quote_beauty']);
    expect(r.text).toMatch(/Маникюр \+ однотонный гель-лак \+ снятие старого покрытия — 850/);
    expect(r.text).toMatch(/1 ч 45 мин/);
  });

  it('option words are matched by stem, service words are not mistaken for options', () => {
    const addons = t.services.find(s => s.key === 'manicure-gel')!.addons!;
    expect(addonsOfText('маникюр с укреплением и ремонтом', addons, 'ru').sort()).toEqual(['repair', 'strengthen']);
    expect(beautyFallbackAnswer(t, 'сколько стоит гигиенический маникюр', 'ru')!.text).toMatch(/Гигиенический маникюр без покрытия — 450/);
  });

  it('Ukrainian solo studio: «Скільки коштує масаж з камінням?»', () => {
    const v = card(velvet);
    const a = beautyFallbackAnswer(v, 'Скільки коштує класичний масаж з гарячим камінням?', 'uk')!;
    expect(a.text).toMatch(/Класичний масаж всього тіла \+ гаряче каміння — 1[\s ]500/);
  });

  it('«Как найти студию?» → address and map from the card', async () => {
    const r = await clientFallback(src, 'Как найти студию?');
    expect(r.text).toContain('Vinohradská 48');
    expect(r.tools).toEqual(['get_studio_info']);
  });

  it('tools: quote_beauty and list_masters are client tools; owner tools are not', () => {
    expect(validateCall('client', 'quote_beauty', {service_id: null, addons: ['removal']}).ok).toBe(true);
    expect(validateCall('client', 'find_free_slots', {service_id: t.services[0]!.id, addons: ['removal'], master_id: '00000000-0000-4000-8000-000000000001'}).ok).toBe(true);
    expect(validateCall('client', 'count_free_slots', {period: 'week', anchor_date: '2026-11-12'}).ok).toBe(false);
    expect(validateCall('client', 'get_bookings', {period: 'day', anchor_date: '2026-11-12'}).ok).toBe(false);
    expect(validateCall('owner', 'quote_beauty', {}).ok).toBe(false);
    const q = beautyQuoteTool(t, {service_id: t.services.find(s => s.key === 'manicure-gel')!.id, addons: ['repair']});
    expect(q.quotes[0]!.price).toBe(870);
    expect(mastersList(t).map(m => m.name)).toEqual(['Анна', 'Виктория']);
    expect(mastersList(t)[1]!.services).toContain('Японский эко-маникюр');
    expect(clientSystemPrompt(t, '2026-11-12')).toMatch(/quote_beauty/);
  });
});

describe('owner assistant (no model)', () => {
  const stats = {period: 'week' as const, from_date: '2026-11-09', to_date: '2026-11-15', from_at: '', to_at: '', bookings: 3, cancelled: 0, no_show: 1, arrivals: 2, completed: 2, received: 1700, refunded: 0, net_received: 1700, expected_value: 2600};
  const src: OwnerSource = {
    timezone: 'Europe/Prague',
    currency: 'CZK',
    studioName: 'Studio',
    lang: 'ru',
    kind: 'beauty',
    stats: async () => stats,
    bookings: async () => [{start_at: '2026-11-13T09:00:00Z', service_name: 'Маникюр', customer_name: 'Ольга', car: '', status: 'confirmed', price: 850, balance: 850, resource_name: 'Анна'}],
    freeSlots: async () => ({from_date: '2026-11-12', to_date: '2026-11-15', services: [{service_id: 's1', service_name: 'Маникюр', free_starts: 14, first_free: '2026-11-13T12:00:00Z'}]}),
  };
  it('«Кто записан на завтра?» lists clients with their master, no car', async () => {
    const r = await ownerFallback(src, 'Кто записан на завтра?');
    expect(r.tools).toEqual(['get_bookings']);
    expect(r.text).toMatch(/Маникюр, Ольга → Анна/);
    expect(r.text).not.toMatch(/\(\)/);
  });
  it('«Сколько свободных окон на этой неделе?» uses count_free_slots', async () => {
    const r = await ownerFallback(src, 'Сколько свободных окон на этой неделе?');
    expect(r.tools).toEqual(['count_free_slots']);
    expect(r.text).toMatch(/Свободных окон .*: 14/);
  });
  it('«Сколько денег получено?» answers money received, not the forecast', async () => {
    const r = await ownerFallback(src, 'Сколько денег получено на этой неделе?');
    expect(r.text).toMatch(/1[\s ]700/);
    expect(r.text).not.toMatch(/2[\s ]600/);
  });
  it('the executor serves count_free_slots read-only', async () => {
    const r = (await ownerExecutor(src)('count_free_slots', {period: 'week', anchor_date: '2026-11-12'})) as {services: unknown[]};
    expect(r.services).toHaveLength(1);
    expect(freeSlotsAnswer({from_date: 'a', to_date: 'b', services: []}, 'на неделе', 'ru', x => x)).toMatch(/нет/);
  });
});

describe('telegram message', () => {
  const job = {
    kind: 'tg_new' as const,
    booking: {
      id: 'b1',
      start_at: '2026-11-13T16:30:00Z',
      service_name: 'Маникюр <гель>',
      price: 1000,
      addons: [{name: 'Снятие', price: 100}],
      master_choice: 'any',
      resource_name: 'Анна',
      customer_name: 'Ольга',
      customer_phone: '+420777555123',
      comment: 'нюд',
    },
    tenant: {slug: 'demo', name: 'Studio', timezone: 'Europe/Prague', currency: 'CZK'},
  };
  it('has the service, time in the studio zone, total, options, master, client and an escaped HTML body', () => {
    const text = telegramText(job, 'ru', 'https://example.test');
    expect(text).toContain('Новая запись');
    expect(text).toContain('Маникюр &lt;гель&gt;');
    expect(text).toMatch(/17:30/);
    expect(text).toMatch(/1[\s ]000/);
    expect(text).toContain('Опции: Снятие');
    expect(text).toContain('Мастер: Анна (любой свободный)');
    expect(text).toContain('+420777555123');
    expect(text).toContain('https://example.test/s/demo/owner/');
    expect(telegramText({...job, kind: 'tg_cancel'}, 'uk', null)).toContain('Клієнт скасував запис');
  });
  it('maps Bot API statuses to outbox outcomes', () => {
    expect(telegramOutcome(200)).toBe('sent');
    expect(telegramOutcome(400)).toBe('failed'); // wrong chat id: retrying will not help
    expect(telegramOutcome(403)).toBe('failed'); // bot blocked
    expect(telegramOutcome(429)).toBe('retry');
    expect(telegramOutcome(502)).toBe('retry');
    expect(telegramOutcome(0)).toBe('retry');
  });
});

describe('browser helpers', () => {
  it('open state: open until closing, otherwise the next opening (exceptions win)', () => {
    const hours = [1, 2, 3, 4, 5].map(weekday => ({weekday, opens: '10:00', closes: '20:00'}));
    const thu = new Date('2026-11-12T13:00:00Z'); // 14:00 in Prague
    expect(openState(hours, [], 'Europe/Prague', thu)).toEqual({open: true, until: '20:00'});
    const late = new Date('2026-11-12T20:00:00Z'); // 21:00
    expect(openState(hours, [], 'Europe/Prague', late)).toEqual({open: false, next: {date: '2026-11-13', opens: '10:00'}});
    const closedFri = [{day: '2026-11-13', is_closed: true, opens: null, closes: null}];
    expect(openState(hours, closedFri, 'Europe/Prague', late)).toEqual({open: false, next: {date: '2026-11-16', opens: '10:00'}});
  });

  it('beauty words override car words; phone country follows the studio', () => {
    setLang('ru', 'beauty');
    expect(msg.status.arrived).toBe('Клиент пришёл');
    expect(msg.settings.tabs.bays).toBe('Мастера');
    expect(msg.home.assistantExamples[1]).toMatch(/маникюр со снятием/);
    setPhoneCountry('+420777123456');
    expect(toE164('777 555 123')).toBe('+420777555123');
    expect(msg.phonePlaceholder).toMatch(/^\+420/);
    for (const lang of ['uk', 'cs', 'pl'] as const) {
      setLang(lang, 'beauty');
      expect(beautyMsg().flow.anyMaster.length).toBeGreaterThan(3);
      expect(msg.status.arrived).not.toMatch(/Auto|авто|машин/i);
    }
    setLang('ru');
    expect(msg.status.arrived).toBe('Машина принята'); // car studios unchanged
  });

  it('accent text on cream reaches 4.5:1 for any brand colour', () => {
    for (const c of ['#7C3AED', '#B4235F', '#F9A8D4', '#FDE047']) {
      const {fill, text} = accentPairLight(c);
      expect(contrast(text, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fill, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
