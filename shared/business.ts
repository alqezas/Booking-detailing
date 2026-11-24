/**
 * business.json — the single input file of the tenant pipeline.
 *
 * The same schema validates the file in `pnpm tenant:validate`, drives the
 * static assets generator (manifest, icons, HTML metadata) and is reused by
 * the owner cabinet for the fields an owner may edit at runtime. The database
 * stays the runtime source of truth; this file only seeds and re-publishes it.
 */
import {z} from 'zod';
import {MAX_DIAMETER, MAX_WHEELS, MIN_DIAMETER, MONTH_DAY_RE, MOUNT_SEASONS, RIMS, VEHICLES} from '../supabase/functions/_shared/tire.ts';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** E.164-ish: a plus and 10–15 digits once spaces, dashes and brackets are removed. */
export const PHONE_RE = /^\+\d{10,15}$/;

export const normalizePhone = (raw: string): string => raw.replace(/[\s()\-]/g, '');

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const minutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Longest single opening interval, in minutes («08:00»–«17:00» → 540). */
export const longestOpening = (intervals: [string, string][]): number =>
  Math.max(0, ...intervals.map(([a, b]) => minutes(b) - minutes(a)));

/**
 * A service shorter than a day must fit into one opening interval; one that
 * is longer than every interval but under 24 h never gets a free slot.
 */
export const neverFitsADay = (durationMinutes: number, intervals: [string, string][]): boolean =>
  durationMinutes < 1440 && durationMinutes > longestOpening(intervals);

const interval = z
  .tuple([z.string().regex(TIME_RE), z.string().regex(TIME_RE)])
  .refine(([a, b]) => minutes(a) < minutes(b), {message: 'Время закрытия должно быть позже открытия'});

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Ключ: латиница, цифры и дефис');

export const CURRENCIES = ['RUB', 'KZT', 'BYN', 'EUR', 'USD', 'CZK', 'PLN', 'UAH'] as const;

export const INFO_CARD_ICONS = [
  'shield',
  'sparkle',
  'clock',
  'drop',
  'car',
  'wrench',
  'medal',
  'sun',
  'coffee',
  'credit-card',
  'tire',
  'snowflake',
  'warehouse',
  'spray',
  'ticket',
  'timer',
  'scissors',
  'hand',
  'flower',
  'leaf',
  'heart',
  'eye',
  'gift',
  'map-pin',
  'calendar',
] as const;

export const TENANT_KINDS = ['detailing', 'autoservice', 'tireservice', 'carwash', 'beauty'] as const;

/** Weekly hours: up to three intervals per day. */
const weekHours = () => z.object(Object.fromEntries(WEEKDAYS.map(d => [d, z.array(interval).max(3)])) as Record<Weekday, z.ZodArray<typeof interval>>);

/**
 * A service option («Removal of old coating +15 min / +100»): the server adds
 * its price and minutes to the service when the client ticks it.
 */
export const addonSchema = z.object({
  key,
  name: z.string().trim().min(2).max(60),
  price: z.number().int().min(0).max(1_000_000),
  minutes: z.number().int().min(0).max(240).default(0),
});

/**
 * A bookable resource: a bay/post for car studios, a master or a place
 * (chair, cabinet) for beauty studios. A master may have an own weekly shift
 * (`hours`; without it the studio hours apply) and own days off.
 */
export const resourceSchema = z.object({
  key,
  name: z.string().trim().min(1).max(40),
  seasonal: z.boolean().optional(),
  role: z.enum(['place', 'master']).optional(),
  title: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(300).optional(),
  photo: z.string().min(1).optional(),
  hours: weekHours().optional(),
  daysOff: z.array(z.string().regex(DATE_RE)).max(60).optional(),
});

const diameter = z.number().int().min(MIN_DIAMETER).max(MAX_DIAMETER);

/**
 * Tyre services: the price matrix of the calculator (see
 * supabase/functions/_shared/tire.ts for the rules), vehicle and rim names in
 * the studio language and the seasons. Every operation points at a service of
 * the same studio: the service row carries the name, category, bays and the
 * «from» price shown when the calculator is not used.
 */
export const tireSchema = z.object({
  operations: z
    .array(
      z.object({
        service: key,
        unit: z.enum(['set', 'job']).default('set'),
        rows: z
          .array(
            z
              .object({
                vehicles: z.array(z.enum(VEHICLES)).min(1).optional(),
                rims: z.array(z.enum(RIMS)).min(1).optional(),
                from: diameter,
                to: diameter,
                /** null = price on request */
                price: z.number().int().min(0).max(1_000_000).nullable(),
                minutes: z.number().int().min(5).max(24 * 60),
              })
              .refine(r => r.from <= r.to, {message: 'from ≤ to'}),
          )
          .min(1)
          .max(80),
      }),
    )
    .min(1)
    .max(20),
  names: z
    .object({
      vehicles: z.object({car: z.string().min(1).max(30), suv: z.string().min(1).max(30), van: z.string().min(1).max(30)}),
      rims: z.object({steel: z.string().min(1).max(30), alloy: z.string().min(1).max(30)}),
    })
    .default({vehicles: {car: 'Osobní', suv: 'SUV / 4×4', van: 'Dodávka'}, rims: {steel: 'Plech', alloy: 'Alu'}}),
  defaultWheels: z.number().int().min(1).max(MAX_WHEELS).default(4),
  /** The studio stores tyre sets (pneuhotel): the booking form offers «from storage». */
  storage: z.boolean().default(false),
  seasons: z
    .array(
      z.object({
        from: z.string().regex(MONTH_DAY_RE, 'MM-DD'),
        to: z.string().regex(MONTH_DAY_RE, 'MM-DD'),
        mount: z.enum(MOUNT_SEASONS),
        horizonDays: z.number().int().min(1).max(120).nullable().optional(),
      }),
    )
    .max(4)
    .default([]),
});
export type TireSettings = z.output<typeof tireSchema>;

const classPrice = z.object({
  /** null = price on request for this class */
  price: z.number().int().min(0).max(1_000_000).nullable(),
  minutes: z.number().int().min(0).max(24 * 60),
});
const classPrices = z.object({small: classPrice.optional(), medium: classPrice.optional(), suv: classPrice.optional(), van: classPrice.optional()});

/**
 * Car wash: programs priced by car class plus optional extras (rules in
 * supabase/functions/_shared/wash.ts). Every program points at a service of
 * the same studio, which carries its name, category and bays.
 */
export const washSchema = z.object({
  classes: z
    .object({small: z.string().min(1).max(30), medium: z.string().min(1).max(30), suv: z.string().min(1).max(30), van: z.string().min(1).max(30)})
    .default({small: 'Malé', medium: 'Střední', suv: 'SUV / MPV', van: 'Dodávka'}),
  /** The plate is optional by default; a studio with wash passes usually wants it. */
  plateRequired: z.boolean().default(false),
  programs: z.array(z.object({service: key, prices: classPrices})).min(1).max(20),
  extras: z
    .array(z.object({key, name: z.string().trim().min(2).max(40), prices: classPrices, programs: z.array(key).optional()}))
    .max(20)
    .default([]),
});
export type WashSettings = z.output<typeof washSchema>;

/** Peak hours (any studio): online booking closed (walk-ins only) or limited to N parallel online bookings. */
export const peakRuleSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    from: z.string().regex(TIME_RE),
    to: z.string().regex(TIME_RE),
    mode: z.enum(['walkin', 'limit']),
    posts: z.number().int().min(1).max(20).nullable().optional(),
  })
  .refine(r => r.from < r.to, {message: 'from < to'})
  .refine(r => r.mode === 'walkin' || !!r.posts, {message: 'limit: posts'});

export const serviceSchema = z.object({
  key,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(''),
  category: z.string().trim().max(40).default('Услуги'),
  price: z.number().int().min(0).max(10_000_000),
  priceFrom: z.boolean().default(false),
  durationMinutes: z
    .number()
    .int()
    .min(15)
    .max(60 * 24 * 14),
  bufferMinutes: z.number().int().min(0).max(24 * 60).optional(),
  resources: z.array(key).min(1),
  addons: z.array(addonSchema).max(10).optional(),
});

export const businessSchema = z
  .object({
    slug: z.string().regex(SLUG_RE, 'slug: латиница, цифры, дефис, до 40 символов'),
    name: z.string().trim().min(2).max(60),
    shortName: z.string().trim().min(1).max(14).optional(),
    kind: z.enum(TENANT_KINDS),
    tagline: z.string().trim().max(90).default(''),
    description: z.string().trim().max(600).default(''),
    /** Interface language of the studio's site and cabinet. */
    locale: z.enum(['ru-RU', 'cs-CZ', 'pl-PL', 'uk-UA', 'de-AT']).default('ru-RU'),
    timezone: z.string().refine(isValidTimeZone, 'Неизвестный часовой пояс IANA'),
    currency: z.enum(CURRENCIES).default('RUB'),
    accentColor: z.string().regex(HEX_RE),
    /** Beauty studios are light by default; "dark" for barbershops and similar. Car studios are always dark. */
    appearance: z.enum(['light', 'dark', 'cream']).optional(),
    /** Interface words on top of the kind: "barber" — barbershops (beauty kind only). */
    vocabulary: z.enum(['barber']).optional(),
    contacts: z.object({
      phone: z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_RE, 'Телефон в формате E.164: +79991234567, +420777056596')),
      address: z.string().trim().min(5).max(200),
      /** Registered office, when it differs from where cars are brought (Czech «sídlo»). */
      legalAddress: z.string().trim().min(5).max(200).optional(),
      mapUrl: z.url().optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      telegram: z.string().max(64).optional(),
      whatsapp: z.string().max(32).optional(),
      /** Profile handles, e.g. «jh_auto_detailing» → instagram.com/jh_auto_detailing. */
      instagram: z.string().regex(/^@?[A-Za-z0-9._]{1,64}$/, 'Instagram: имя профиля без ссылки').optional(),
      /** Page name («jhautodetailingcz») or the full https://www.facebook.com/… link for pages without one. */
      facebook: z.union([z.string().regex(/^[A-Za-z0-9.\-]{1,64}$/), z.url().startsWith('https://www.facebook.com/').max(200)], {error: 'Facebook: имя страницы или ссылка https://www.facebook.com/…'}).optional(),
      tiktok: z.string().regex(/^@?[A-Za-z0-9._]{1,64}$/, 'TikTok: имя профиля без ссылки').optional(),
      email: z.email().optional(),
    }),
    images: z.object({
      hero: z.string().min(1),
      logo: z.string().min(1),
      icon: z.string().min(1).optional(),
    }),
    hours: weekHours(),
    closedDates: z.array(z.string().regex(DATE_RE)).default([]),
    booking: z
      .object({
        slotStepMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
        minLeadMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
        horizonDays: z.number().int().min(1).max(120).default(30),
        cancelCutoffHours: z.number().int().min(0).max(14 * 24).default(12),
        defaultBufferMinutes: z.number().int().min(0).max(240).default(30),
        peakHours: z.array(peakRuleSchema).max(10).optional(),
      })
      .default({slotStepMinutes: 30, minLeadMinutes: 60, horizonDays: 30, cancelCutoffHours: 12, defaultBufferMinutes: 30}),
    /** seasonal: a post that takes bookings only inside a tyre season. */
    resources: z.array(resourceSchema).min(1).max(20),
    services: z.array(serviceSchema).min(1).max(60),
    infoCards: z
      .array(
        z.object({
          icon: z.enum(INFO_CARD_ICONS),
          title: z.string().trim().min(2).max(40),
          text: z.string().trim().min(2).max(160),
        }),
      )
      .length(3),
    gallery: z
      .array(
        z.object({
          /** The result («after»). */
          image: z.string().min(1),
          /** Optional «before» photo of the same work, shown side by side. */
          before: z.string().min(1).optional(),
          caption: z.string().trim().max(120).default(''),
        }),
      )
      .max(40),
    /**
     * Frequently asked questions: shown on the home page and used by the
     * assistant. `keywords` (lower case, without diacritics) help the no-model
     * fallback recognise the question; the model reads the text itself.
     */
    faq: z
      .array(
        z.object({
          question: z.string().trim().min(3).max(120),
          answer: z.string().trim().min(3).max(1500),
          keywords: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
        }),
      )
      .max(20)
      .default([]),
    owner: z.object({email: z.email()}),
    /**
     * Instant owner notifications. The chat id is not secret but stays out of
     * the public card; the bot token is a server secret (TELEGRAM_BOT_TOKEN).
     */
    notifications: z
      .object({telegramChatId: z.string().regex(/^(-?\d{5,20}|@[A-Za-z0-9_]{5,32})$/, 'Telegram chat id: число или @канал').optional()})
      .optional(),
    assistant: z.object({enabled: z.boolean().default(true)}).default({enabled: true}),
    tire: tireSchema.optional(),
    wash: washSchema.optional(),
  })
  .superRefine((b, ctx) => {
    const resourceKeys = new Set(b.resources.map(r => r.key));
    if (resourceKeys.size !== b.resources.length) {
      ctx.addIssue({code: 'custom', path: ['resources'], message: 'Ключи боксов должны быть уникальны'});
    }
    const serviceKeys = new Set<string>();
    b.services.forEach((s, i) => {
      if (serviceKeys.has(s.key)) ctx.addIssue({code: 'custom', path: ['services', i, 'key'], message: 'Повтор ключа услуги'});
      serviceKeys.add(s.key);
      s.resources.forEach(r => {
        if (!resourceKeys.has(r)) {
          ctx.addIssue({code: 'custom', path: ['services', i, 'resources'], message: `Нет бокса «${r}»`});
        }
      });
    });
    if (b.kind === 'tireservice' && !b.tire) {
      ctx.addIssue({code: 'custom', path: ['tire'], message: 'Шиномонтажу нужна матрица цен (tire)'});
    }
    b.tire?.operations.forEach((o, i) => {
      if (!serviceKeys.has(o.service)) ctx.addIssue({code: 'custom', path: ['tire', 'operations', i, 'service'], message: `Нет услуги «${o.service}»`});
    });
    if (b.kind === 'carwash' && !b.wash) {
      ctx.addIssue({code: 'custom', path: ['wash'], message: 'Мойке нужен прайс по классам (wash)'});
    }
    b.wash?.programs.forEach((p, i) => {
      if (!serviceKeys.has(p.service)) ctx.addIssue({code: 'custom', path: ['wash', 'programs', i, 'service'], message: `Нет услуги «${p.service}»`});
    });
    const extraKeys = new Set<string>();
    b.wash?.extras.forEach((e, i) => {
      if (extraKeys.has(e.key)) ctx.addIssue({code: 'custom', path: ['wash', 'extras', i, 'key'], message: 'Повтор ключа доп. услуги'});
      extraKeys.add(e.key);
      e.programs?.forEach(p => {
        if (!serviceKeys.has(p)) ctx.addIssue({code: 'custom', path: ['wash', 'extras', i, 'programs'], message: `Нет услуги «${p}»`});
      });
    });
    b.services.forEach((s, i) => {
      const seen = new Set<string>();
      s.addons?.forEach((a, j) => {
        if (seen.has(a.key)) ctx.addIssue({code: 'custom', path: ['services', i, 'addons', j, 'key'], message: 'Повтор ключа опции'});
        seen.add(a.key);
      });
      if (s.addons?.length && b.kind !== 'beauty') {
        ctx.addIssue({code: 'custom', path: ['services', i, 'addons'], message: 'Опции услуг (addons) — для бьюти-студий; у мойки — wash.extras'});
      }
    });
    // A master's shift narrows the studio hours: it must lie inside them.
    b.resources.forEach((r, i) => {
      if (!r.hours) return;
      WEEKDAYS.forEach(d => {
        r.hours![d].forEach(([a, z2], j) => {
          const inside = b.hours[d].some(([o, c]) => minutes(o) <= minutes(a) && minutes(z2) <= minutes(c));
          if (!inside) ctx.addIssue({code: 'custom', path: ['resources', i, 'hours', d, j], message: `Смена ${a}–${z2} выходит за часы студии (${d})`});
        });
      });
      if (WEEKDAYS.every(d => r.hours![d].length === 0)) {
        ctx.addIssue({code: 'custom', path: ['resources', i, 'hours'], message: 'У мастера нет ни одного рабочего дня'});
      }
    });
    if (WEEKDAYS.every(d => b.hours[d].length === 0)) {
      ctx.addIssue({code: 'custom', path: ['hours'], message: 'Нужен хотя бы один рабочий день'});
    }
  });

export type BusinessConfig = z.output<typeof businessSchema>;
export type BusinessConfigInput = z.input<typeof businessSchema>;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: tz});
    return true;
  } catch {
    return false;
  }
}

/**
 * Values the `tenant:new` scaffold writes. `tenant:verify --activate` refuses
 * to switch a studio to live while any of them is still present, so a preview
 * can never go live with placeholder contacts.
 */
export const PLACEHOLDER_MARKERS = ['+70000000000', 'owner@example.com', 'Адрес студии'];

export function findPlaceholders(b: BusinessConfig): string[] {
  const found: string[] = [];
  if (b.contacts.phone === '+70000000000') found.push('contacts.phone');
  if (b.owner.email === 'owner@example.com') found.push('owner.email');
  if (b.contacts.address.includes('Адрес студии')) found.push('contacts.address');
  return found;
}
