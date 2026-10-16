import {z} from 'zod';
import {HEX_RE, PHONE_RE, TIME_RE, normalizePhone} from '../../shared/business.ts';

/** Accepts «8 999 123-45-67», «+7 (999) 123 45 67», «9991234567» → +79991234567. */
export function toE164(raw: string): string {
  let p = normalizePhone(raw.trim());
  if (/^8\d{10}$/.test(p)) p = '+7' + p.slice(1);
  else if (/^9\d{9}$/.test(p)) p = '+7' + p;
  else if (/^7\d{10}$/.test(p)) p = '+' + p;
  return p;
}

const phone = z
  .string()
  .trim()
  .min(1, 'Укажите телефон')
  .transform(toE164)
  .refine(v => PHONE_RE.test(v), 'Телефон в формате +7 999 123-45-67');

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(80, 'Слишком длинное имя'),
  phone,
  car: z.string().trim().min(2, 'Укажите марку и модель').max(80, 'Слишком длинно'),
  comment: z.string().trim().max(500, 'Комментарий до 500 символов').default(''),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const loginSchema = z.object({
  email: z.email('Введите почту'),
  password: z.string().min(6, 'Пароль от 6 символов'),
});

export const studioSettingsSchema = z.object({
  name: z.string().trim().min(2, 'От 2 символов').max(60),
  tagline: z.string().trim().max(90),
  description: z.string().trim().max(600),
  phone,
  address: z.string().trim().min(5, 'Укажите адрес').max(200),
  map_url: z.union([z.literal(''), z.url('Ссылка должна начинаться с https://').startsWith('https://', 'Нужна ссылка https://')]),
  accent_color: z.string().regex(HEX_RE, 'Цвет в формате #4690FF'),
});

export const bookingRulesSchema = z.object({
  slot_step_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  min_lead_minutes: z.number().int().min(0).max(10080),
  horizon_days: z.number().int().min(1).max(120),
  cancel_cutoff_hours: z.number().int().min(0).max(336),
  default_buffer_minutes: z.number().int().min(0).max(240),
});

export const serviceEditSchema = z.object({
  name: z.string().trim().min(2, 'От 2 символов').max(80),
  description: z.string().trim().max(400),
  category: z.string().trim().min(1, 'Укажите раздел').max(40),
  price: z.number({error: 'Укажите цену'}).int().min(0).max(10_000_000),
  price_from: z.boolean(),
  duration_minutes: z.number({error: 'Укажите длительность'}).int().min(15, 'Минимум 15 минут').max(20160),
  buffer_minutes: z.number().int().min(0).max(1440).nullable(),
  resource_ids: z.array(z.string().uuid()).min(1, 'Выберите хотя бы один бокс'),
});

export const hoursRowSchema = z
  .object({weekday: z.number().int().min(1).max(7), opens: z.string().regex(TIME_RE), closes: z.string().regex(TIME_RE)})
  .refine(r => r.opens < r.closes, {message: 'Закрытие позже открытия', path: ['closes']});

export const infoCardSchema = z.object({
  title: z.string().trim().min(2, 'От 2 символов').max(40),
  text: z.string().trim().min(2, 'От 2 символов').max(160),
  icon: z.string(),
});

export const captionSchema = z.string().trim().max(120, 'До 120 символов');

export const paymentSchema = z.object({
  amount: z.number({error: 'Укажите сумму'}).int('Целое число').positive('Больше нуля').max(10_000_000),
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
