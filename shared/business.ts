/**
 * business.json — the single input file of the tenant pipeline.
 *
 * The same schema validates the file in `pnpm tenant:validate`, drives the
 * static assets generator (manifest, icons, HTML metadata) and is reused by
 * the owner cabinet for the fields an owner may edit at runtime. The database
 * stays the runtime source of truth; this file only seeds and re-publishes it.
 */
import {z} from 'zod';

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

const interval = z
  .tuple([z.string().regex(TIME_RE), z.string().regex(TIME_RE)])
  .refine(([a, b]) => minutes(a) < minutes(b), {message: 'Время закрытия должно быть позже открытия'});

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Ключ: латиница, цифры и дефис');

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
] as const;

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
});

export const businessSchema = z
  .object({
    slug: z.string().regex(SLUG_RE, 'slug: латиница, цифры, дефис, до 40 символов'),
    name: z.string().trim().min(2).max(60),
    shortName: z.string().trim().min(1).max(14).optional(),
    kind: z.enum(['detailing', 'autoservice']),
    tagline: z.string().trim().max(90).default(''),
    description: z.string().trim().max(600).default(''),
    locale: z.literal('ru-RU').default('ru-RU'),
    timezone: z.string().refine(isValidTimeZone, 'Неизвестный часовой пояс IANA'),
    currency: z.enum(['RUB', 'KZT', 'BYN', 'EUR', 'USD']).default('RUB'),
    accentColor: z.string().regex(HEX_RE),
    contacts: z.object({
      phone: z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_RE, 'Телефон в формате +79991234567')),
      address: z.string().trim().min(5).max(200),
      mapUrl: z.url().optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      telegram: z.string().max(64).optional(),
      whatsapp: z.string().max(32).optional(),
      email: z.email().optional(),
    }),
    images: z.object({
      hero: z.string().min(1),
      logo: z.string().min(1),
      icon: z.string().min(1).optional(),
    }),
    hours: z.object(Object.fromEntries(WEEKDAYS.map(d => [d, z.array(interval).max(3)])) as Record<Weekday, z.ZodArray<typeof interval>>),
    closedDates: z.array(z.string().regex(DATE_RE)).default([]),
    booking: z
      .object({
        slotStepMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
        minLeadMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
        horizonDays: z.number().int().min(1).max(120).default(30),
        cancelCutoffHours: z.number().int().min(0).max(14 * 24).default(12),
        defaultBufferMinutes: z.number().int().min(0).max(240).default(30),
      })
      .default({slotStepMinutes: 30, minLeadMinutes: 60, horizonDays: 30, cancelCutoffHours: 12, defaultBufferMinutes: 30}),
    resources: z.array(z.object({key, name: z.string().trim().min(1).max(40)})).min(1).max(20),
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
    gallery: z.array(z.object({image: z.string().min(1), caption: z.string().trim().max(120).default('')})).max(40),
    owner: z.object({email: z.email()}),
    assistant: z.object({enabled: z.boolean().default(true)}).default({enabled: true}),
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
