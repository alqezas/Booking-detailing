import {z} from 'zod';
import {HEX_RE, PHONE_RE, TIME_RE, normalizePhone} from '../../shared/business.ts';
import {msg, type Messages} from '../i18n/index.ts';

/** Validation messages are read when a check fails, so they follow the studio's language. */
const say = (pick: (v: Messages['v']) => string) => ({error: () => pick(msg.v)});

/**
 * Accepts local and international spellings and returns E.164:
 *   ru: «8 999 123-45-67», «+7 (999) 123 45 67», «9991234567» → +79991234567
 *   cs: «777 056 596», «00420 777 056 596», «+420777056596» → +420777056596
 *   pl: «533 557 260», «0048 533 557 260», «+48533557260» → +48533557260
 *   uk: «050 123 45 67», «+38 050 123 45 67», «+380501234567» → +380501234567
 *   de: «0664 123 4567», «01 920 8295», «0043 664 1234567» → +436641234567
 */
export function toE164(raw: string, country: string = msg.phoneCountry): string {
  let p = normalizePhone(raw.trim());
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('+')) return p;
  if (country === '7') {
    if (/^8\d{10}$/.test(p)) return '+7' + p.slice(1);
    if (/^9\d{9}$/.test(p)) return '+7' + p;
    if (/^7\d{10}$/.test(p)) return '+' + p;
  } else if (country === '420') {
    if (/^\d{9}$/.test(p)) return '+420' + p;
    if (/^42[01]\d{9}$/.test(p)) return '+' + p;
  } else if (country === '48') {
    if (/^\d{9}$/.test(p)) return '+48' + p;
    if (/^48\d{9}$/.test(p)) return '+' + p;
  } else if (country === '43') {
    if (/^0[1-9]\d{5,12}$/.test(p)) return '+43' + p.slice(1);
    if (/^43[1-9]\d{5,12}$/.test(p)) return '+' + p;
  } else if (country === '380') {
    if (/^0\d{9}$/.test(p)) return '+38' + p;
    if (/^380\d{9}$/.test(p)) return '+' + p;
    if (/^\d{9}$/.test(p)) return '+380' + p;
  }
  return p;
}

const phone = z
  .string()
  .trim()
  .min(1, say(v => v.phoneRequired))
  .transform(v => toE164(v))
  .refine(v => PHONE_RE.test(v), say(v => v.phoneFormat));

export const customerSchema = z.object({
  name: z.string().trim().min(2, say(v => v.nameRequired)).max(80, say(v => v.nameLong)),
  phone,
  car: z.string().trim().min(2, say(v => v.carRequired)).max(80, say(v => v.tooLong)),
  comment: z.string().trim().max(500, say(v => v.commentLong)).default(''),
});
export type CustomerInput = z.input<typeof customerSchema>;
/** A beauty client: no car, just a name, a phone and an optional wish for the visit. */
export const personSchema = customerSchema.omit({car: true});

export const loginSchema = z.object({
  email: z.email(say(v => v.emailRequired)),
  password: z.string().min(6, say(v => v.passwordShort)),
});

export const studioSettingsSchema = z.object({
  name: z.string().trim().min(2, say(v => v.min2)).max(60),
  tagline: z.string().trim().max(90),
  description: z.string().trim().max(600),
  phone,
  address: z.string().trim().min(5, say(v => v.addressRequired)).max(200),
  legal_address: z.string().trim().max(200),
  map_url: z.union([z.literal(''), z.url(say(v => v.urlHttps)).startsWith('https://', say(v => v.needHttps))]),
  accent_color: z.string().regex(HEX_RE, say(v => v.colorFormat)),
});

export const bookingRulesSchema = z.object({
  slot_step_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  min_lead_minutes: z.number().int().min(0).max(10080),
  horizon_days: z.number().int().min(1).max(120),
  cancel_cutoff_hours: z.number().int().min(0).max(336),
  default_buffer_minutes: z.number().int().min(0).max(240),
});

export const serviceEditSchema = z.object({
  name: z.string().trim().min(2, say(v => v.min2)).max(80),
  description: z.string().trim().max(400),
  category: z.string().trim().min(1, say(v => v.categoryRequired)).max(40),
  price: z.number(say(v => v.priceRequired)).int().min(0).max(10_000_000),
  price_from: z.boolean(),
  duration_minutes: z.number(say(v => v.durationRequired)).int().min(15, say(v => v.min15)).max(20160),
  buffer_minutes: z.number().int().min(0).max(1440).nullable(),
  resource_ids: z.array(z.string().uuid()).min(1, say(v => v.bayRequired)),
});

export const hoursRowSchema = z
  .object({weekday: z.number().int().min(1).max(7), opens: z.string().regex(TIME_RE), closes: z.string().regex(TIME_RE)})
  .refine(r => r.opens < r.closes, {...say(v => v.closeAfterOpen), path: ['closes']});

export const infoCardSchema = z.object({
  title: z.string().trim().min(2, say(v => v.min2)).max(40),
  text: z.string().trim().min(2, say(v => v.min2)).max(160),
  icon: z.string(),
});

export const captionSchema = z.string().trim().max(120, say(v => v.upTo120));

export const paymentSchema = z.object({
  amount: z.number(say(v => v.amountRequired)).int(say(v => v.integer)).positive(say(v => v.positive)).max(10_000_000),
  method: z.enum(['cash', 'card', 'transfer', 'other']),
  note: z.string().trim().max(200),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = i.path.join('.');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
