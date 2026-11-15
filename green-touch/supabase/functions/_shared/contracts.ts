/**
 * Contracts shared by the storefront (Vite) and the Edge Functions (Deno).
 * Only `zod` and Web APIs here, so both runtimes import the same file.
 */
import {z} from 'zod';

// ── Money ────────────────────────────────────────────────────────────────────
/** Kit discount, identical to private.discount_kop: basis points, half up to a kopeck. */
export function kitDiscountKop(baseKop: number, bp: number): number {
  return Math.floor((baseKop * bp + 5000) / 10000);
}

/** «1 234 грн» or «1 234,50 грн» (Ukrainian grouping). */
export function formatUah(kop: number): string {
  const whole = Math.trunc(kop / 100);
  const rest = Math.abs(kop % 100);
  const grouped = Math.abs(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${kop < 0 ? '−' : ''}${grouped}${rest ? ',' + rest.toString().padStart(2, '0') : ''} грн`;
}

// ── Price filter ─────────────────────────────────────────────────────────────
/**
 * One comparison rule everywhere: inclusive bounds in kopecks on the purchase
 * price (kits after discount). Quick bands are disjoint intervals of whole
 * kopecks: «до 500» = 0…49 999, «500–1000» = 50 000…99 999, and so on.
 * Manual «від/до» fields in hryvnias map to min×100 … max×100 (inclusive).
 */
export const PRICE_BANDS = [
  {key: 'do-500', label: 'До 500 грн', min: null, max: 49_999},
  {key: '500-1000', label: '500–1000 грн', min: 50_000, max: 99_999},
  {key: '1000-1500', label: '1000–1500 грн', min: 100_000, max: 149_999},
  {key: 'vid-1500', label: 'Від 1500 грн', min: 150_000, max: null},
] as const;
export type PriceBandKey = (typeof PRICE_BANDS)[number]['key'];

export function priceBounds(input: {band?: string | null; min?: number | null; max?: number | null}): {minKop: number | null; maxKop: number | null} {
  const band = PRICE_BANDS.find(b => b.key === input.band);
  if (band) return {minKop: band.min, maxKop: band.max};
  return {
    minKop: input.min != null && Number.isFinite(input.min) ? Math.max(0, Math.round(input.min * 100)) : null,
    maxKop: input.max != null && Number.isFinite(input.max) ? Math.max(0, Math.round(input.max * 100)) : null,
  };
}

// ── Catalog query (URL ⇄ RPC) ────────────────────────────────────────────────
export const SORTS = [
  {key: 'popular', label: 'Популярні'},
  {key: 'new', label: 'Новинки'},
  {key: 'price_asc', label: 'Від дешевих до дорогих'},
  {key: 'price_desc', label: 'Від дорогих до дешевих'},
] as const;
export type SortKey = (typeof SORTS)[number]['key'];

const slug = z.string().regex(/^[a-z0-9-]{1,40}$/);
export const catalogQuerySchema = z.object({
  category: slug.nullable().default(null),
  skin: z.array(slug).max(10).default([]),
  need: z.array(slug).max(15).default([]),
  purpose: z.array(slug).max(10).default([]),
  age: z.array(slug).max(10).default([]),
  season: z.array(slug).max(5).default([]),
  band: z.string().max(20).nullable().default(null),
  min: z.number().int().min(0).max(1_000_000).nullable().default(null),
  max: z.number().int().min(0).max(1_000_000).nullable().default(null),
  q: z.string().max(80).default(''),
  sort: z.enum(['popular', 'new', 'price_asc', 'price_desc']).default('popular'),
  page: z.number().int().min(1).max(500).default(1),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
const int = (v: string | null) => (v != null && /^\d{1,7}$/.test(v) ? Number(v) : null);

export function parseCatalogParams(sp: URLSearchParams): CatalogQuery {
  const raw = {
    category: sp.get('kategoriia') || null,
    skin: list(sp.get('typ')),
    need: list(sp.get('potreba')),
    purpose: list(sp.get('pryznachennia')),
    age: list(sp.get('vik')),
    season: list(sp.get('sezon')),
    band: sp.get('tsina') || null,
    min: int(sp.get('vid')),
    max: int(sp.get('do')),
    q: (sp.get('q') ?? '').slice(0, 80),
    sort: sp.get('sort') ?? 'popular',
    page: int(sp.get('storinka')) ?? 1,
  };
  const parsed = catalogQuerySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Drop whatever is invalid instead of failing the whole page.
  return catalogQuerySchema.parse({
    ...Object.fromEntries(
      Object.entries(raw).filter(([k]) => !parsed.error.issues.some(i => i.path[0] === k)),
    ),
  });
}

/** Canonical URL params (stable order, defaults omitted) so back/forward work. */
export function catalogParams(q: CatalogQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.category) sp.set('kategoriia', q.category);
  if (q.skin.length) sp.set('typ', [...q.skin].sort().join(','));
  if (q.need.length) sp.set('potreba', [...q.need].sort().join(','));
  if (q.purpose.length) sp.set('pryznachennia', [...q.purpose].sort().join(','));
  if (q.age.length) sp.set('vik', [...q.age].sort().join(','));
  if (q.season.length) sp.set('sezon', [...q.season].sort().join(','));
  if (q.band) sp.set('tsina', q.band);
  else {
    if (q.min != null) sp.set('vid', String(q.min));
    if (q.max != null) sp.set('do', String(q.max));
  }
  if (q.q.trim()) sp.set('q', q.q.trim());
  if (q.sort !== 'popular') sp.set('sort', q.sort);
  if (q.page > 1) sp.set('storinka', String(q.page));
  return sp;
}

/** RPC arguments of public.catalog_search for a query. */
export function catalogRpcArgs(q: CatalogQuery, pageSize = 24) {
  const {minKop, maxKop} = priceBounds(q);
  const arr = (a: string[]) => (a.length ? a : null);
  return {
    p_category: q.category,
    p_skin: arr(q.skin),
    p_need: arr(q.need),
    p_purpose: arr(q.purpose),
    p_age: arr(q.age),
    p_season: arr(q.season),
    p_min_kop: minKop,
    p_max_kop: maxKop,
    p_q: q.q.trim() || null,
    p_sort: q.sort,
    p_page: q.page,
    p_page_size: pageSize,
  };
}

// ── «Що турбує вашу шкіру?» ──────────────────────────────────────────────────
export const CONCERNS = [
  {label: 'Зморшки', need: 'zmorshky'},
  {label: 'Сухість', need: 'sukhist'},
  {label: 'Пігментація', need: 'pihmentatsiia'},
  {label: 'Висипання', need: 'vysypannia'},
  {label: 'Почервоніння', need: 'pochervoninnia'},
  {label: 'Втрата пружності', need: 'pruzhnist'},
] as const;

// ── Checkout ─────────────────────────────────────────────────────────────────
/** Ukrainian mobile number → +380XXXXXXXXX, or null. */
export function normalizeUaPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  let d = digits.replace(/^\+/, '');
  if (d.startsWith('380')) d = d.slice(3);
  else if (d.startsWith('80')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^[1-9]\d{8}$/.test(d) ? `+380${d}` : null;
}

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Вкажіть ${label}`)
    .max(60, 'Не більше 60 символів')
    .regex(/^[\p{L}' ʼ’-]+$/u, 'Лише літери, апостроф і дефіс');

export const customerSchema = z.object({
  first_name: name("ім'я"),
  last_name: name('прізвище'),
  phone: z
    .string()
    .trim()
    .min(1, 'Вкажіть телефон')
    .transform((v, ctx) => {
      const p = normalizeUaPhone(v);
      if (!p) {
        ctx.addIssue({code: 'custom', message: 'Номер у форматі +380XXXXXXXXX'});
        return z.NEVER;
      }
      return p;
    }),
  email: z
    .string()
    .trim()
    .max(120, 'Не більше 120 символів')
    .refine(v => v === '' || z.email().safeParse(v).success, 'Перевірте email')
    .default(''),
  comment: z.string().trim().max(1000, 'Не більше 1000 символів').default(''),
});
export type CustomerInput = z.input<typeof customerSchema>;

const npRef = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Оберіть значення зі списку');

export const DELIVERY_METHODS = [
  {key: 'np_branch', label: 'Нова пошта — відділення'},
  {key: 'np_postomat', label: 'Нова пошта — поштомат'},
] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number]['key'];

/** The client sends only identifiers; the server re-reads names from the NP API. */
export const deliverySchema = z.object({
  method: z.enum(['np_branch', 'np_postomat'], {message: 'Оберіть спосіб доставки'}),
  settlement_ref: npRef,
  city_ref: npRef,
  warehouse_ref: npRef,
});

export const cartLineSchema = z.object({
  id: z.uuid(),
  qty: z.number().int().min(1).max(50),
});

export const checkoutRequestSchema = z.object({
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
  lines: z.array(cartLineSchema).min(1).max(30),
  customer: customerSchema,
  delivery: deliverySchema,
  consent: z.literal(true, {message: 'Потрібна ваша згода'}),
  expected_total_kop: z.number().int().min(0).optional(),
});
export type CheckoutRequest = z.input<typeof checkoutRequestSchema>;

// ── Nova Poshta warehouse types (Ref values from AddressGeneral.getWarehouseTypes) ──
export const NP_TYPES = {
  postomat: ['f9316480-5f2d-425d-bc2c-ac7cd29decf0', '95dc212d-479c-4ffb-a8ab-8c1b9073d0bc'],
  branch: ['841339c7-591a-42e2-8233-7a0a00f0ed6f', '9a68df70-0267-42a8-bb5c-37f427e36ee4', '6f8c7162-4b72-4b0a-88e5-906948c6a92f'],
} as const;

export function npTypesFor(method: DeliveryMethod): readonly string[] {
  return method === 'np_postomat' ? NP_TYPES.postomat : NP_TYPES.branch;
}

export type NpSettlement = {
  settlement_ref: string;
  city_ref: string;
  name: string;
  area: string;
  region: string;
  type: string;
  label: string;
};
export type NpWarehouse = {
  ref: string;
  number: string;
  name: string;
  short_address: string;
  type_ref: string;
  category: string;
  city_ref: string;
  settlement_ref: string;
};

// ── Errors shown to buyers ───────────────────────────────────────────────────
export const ERROR_TEXT: Record<string, string> = {
  BAD_REQUEST: 'Перевірте дані форми.',
  RATE_LIMITED: 'Забагато спроб. Спробуйте за кілька хвилин.',
  ITEM_UNAVAILABLE: 'Деякі товари зараз не приймаються до замовлення. Оновіть кошик.',
  PRICE_CHANGED: 'Ціни змінилися. Перевірте нову суму й підтвердьте замовлення ще раз.',
  IDEMPOTENCY_MISMATCH: 'Це замовлення вже надіслано з іншими даними. Оновіть сторінку.',
  NP_POINT_INVALID: 'Оберіть відділення або поштомат зі списку для вибраного населеного пункту.',
  NP_UNAVAILABLE: 'Сервіс Нової пошти зараз недоступний. Спробуйте трохи пізніше.',
  PAYMENT_UNAVAILABLE: 'Не вдалося створити оплату. Замовлення збережено — спробуйте оплатити ще раз.',
  ORDER_NOT_FOUND: 'Замовлення не знайдено.',
  ORDER_CANCELLED: 'Замовлення скасовано.',
  EMPTY_CART: 'Кошик порожній.',
  INTERNAL: 'Сталася помилка. Спробуйте ще раз.',
};
