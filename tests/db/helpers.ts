import {randomBytes, randomUUID} from 'node:crypto';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {formatInTimeZone, fromZonedTime} from 'date-fns-tz';
import pg from 'pg';
import {businessSchema, type BusinessConfigInput} from '../../shared/business.ts';

export const env = () => ({
  url: process.env.SB_API_URL!,
  anon: process.env.SB_ANON_KEY!,
  service: process.env.SB_SERVICE_ROLE_KEY!,
  db: process.env.SB_DB_URL!,
});

export const admin = (): SupabaseClient =>
  createClient(env().url, env().service, {auth: {persistSession: false, autoRefreshToken: false}});

let pool: pg.Pool | null = null;
export const db = (): pg.Pool => (pool ??= new pg.Pool({connectionString: env().db, max: 20}));
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export const key = (): string => randomBytes(18).toString('base64url');
export const fakeIp = (): string => `10.${randomInt(255)}.${randomInt(255)}.${randomInt(255)}`;
const randomInt = (n: number) => Math.floor(Math.random() * n);

/** A PostgREST RPC call exactly as the browser makes it (anon key, own IP). */
export async function anonRpc<T = any>(fn: string, args: Record<string, unknown>, ip = fakeIp()): Promise<{status: number; data: T; error: any}> {
  const res = await fetch(`${env().url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {apikey: env().anon, 'content-type': 'application/json', 'x-forwarded-for': ip},
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  return res.ok ? {status: res.status, data: body as T, error: null} : {status: res.status, data: null as T, error: body};
}

export type TestTenant = {
  id: string;
  slug: string;
  timezone: string;
  services: Record<string, string>;
  resources: Record<string, string>;
};

const OPEN_ALL_WEEK = {
  mon: [['09:00', '21:00']],
  tue: [['09:00', '21:00']],
  wed: [['09:00', '21:00']],
  thu: [['09:00', '21:00']],
  fri: [['09:00', '21:00']],
  sat: [['09:00', '21:00']],
  sun: [['09:00', '21:00']],
};

/** Creates an isolated studio through the real pipeline function. */
export async function createTestTenant(overrides: Partial<BusinessConfigInput> = {}): Promise<TestTenant> {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const config = businessSchema.parse({
    slug,
    name: `Test ${slug}`,
    kind: 'detailing',
    timezone: 'Europe/Moscow',
    accentColor: '#4690FF',
    contacts: {phone: '+79990000000', address: 'Test street 1'},
    images: {hero: '/hero.webp', logo: '/logo.png'},
    hours: OPEN_ALL_WEEK,
    booking: {slotStepMinutes: 30, minLeadMinutes: 0, horizonDays: 30, cancelCutoffHours: 12, defaultBufferMinutes: 30},
    resources: [
      {key: 'bay-1', name: 'Bay 1'},
      {key: 'bay-2', name: 'Bay 2'},
    ],
    services: [
      {key: 'wash', name: 'Wash', price: 3000, durationMinutes: 60, bufferMinutes: 0, resources: ['bay-1']},
      {key: 'polish', name: 'Polish', price: 10000, durationMinutes: 120, resources: ['bay-1', 'bay-2']},
      {key: 'ceramic', name: 'Ceramic', price: 40000, durationMinutes: 1980, bufferMinutes: 60, resources: ['bay-1']},
    ],
    infoCards: [
      {icon: 'shield', title: 'One', text: 'One text'},
      {icon: 'clock', title: 'Two', text: 'Two text'},
      {icon: 'car', title: 'Three', text: 'Three text'},
    ],
    gallery: [],
    owner: {email: `owner-${slug}@test.local`},
    ...overrides,
  });
  const {data, error} = await admin().rpc('svc_sync_tenant', {p_config: config, p_config_hash: 'test', p_sync_content: true});
  if (error) throw new Error(error.message);
  const id = (data as {tenant_id: string}).tenant_id;
  const {rows: services} = await db().query('select key, id from services where tenant_id = $1', [id]);
  const {rows: resources} = await db().query('select key, id from resources where tenant_id = $1', [id]);
  return {
    id,
    slug,
    timezone: config.timezone,
    services: Object.fromEntries(services.map(r => [r.key, r.id])),
    resources: Object.fromEntries(resources.map(r => [r.key, r.id])),
  };
}

/** Local date `days` from today in the studio's time zone, as YYYY-MM-DD. */
export const localDate = (tz: string, days: number): string =>
  formatInTimeZone(new Date(Date.now() + days * 86_400_000), tz, 'yyyy-MM-dd');

/** ISO instant of a local wall-clock time in the studio's time zone. */
export const at = (tz: string, date: string, time: string): string => fromZonedTime(`${date}T${time}:00`, tz).toISOString();

export function bookingArgs(t: TestTenant, service: string, startAt: string, extra: Record<string, unknown> = {}) {
  return {
    p_slug: t.slug,
    p_service_id: t.services[service],
    p_start_at: startAt,
    p_customer_name: 'Тест Клиент',
    p_customer_phone: `+7988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    p_car: 'Kia Rio',
    p_comment: '',
    p_idempotency_key: key(),
    ...extra,
  };
}

/** Creates an owner account for a studio and returns a signed-in client. */
export async function ownerClient(slug: string): Promise<{client: SupabaseClient; userId: string}> {
  const email = `owner-${slug}-${randomUUID().slice(0, 6)}@test.local`;
  const password = randomBytes(12).toString('base64url');
  const a = admin();
  const {data, error} = await a.auth.admin.createUser({email, password, email_confirm: true});
  if (error) throw error;
  const {error: e2} = await a.rpc('svc_add_member', {p_slug: slug, p_user_id: data.user.id, p_role: 'owner'});
  if (e2) throw e2;
  const client = createClient(env().url, env().anon, {auth: {persistSession: false, autoRefreshToken: false}});
  const {error: e3} = await client.auth.signInWithPassword({email, password});
  if (e3) throw e3;
  return {client, userId: data.user.id};
}

export function errorCode(error: any): string | undefined {
  return error?.message ?? error?.code;
}
