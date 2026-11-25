import {randomBytes, randomUUID} from 'node:crypto';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import pg from 'pg';
import type {Ctx} from '../../supabase/functions/_shared/ctx.ts';
import type {Mailer} from '../../supabase/functions/_shared/email.ts';
import {handleCheckout, handleOrder} from '../../supabase/functions/_shared/handlers.ts';
import {NP_FIX, NP_POINTS} from '../fakes/np.ts';

export const env = () => ({
  url: process.env.SB_API_URL!,
  anon: process.env.SB_ANON_KEY!,
  service: process.env.SB_SERVICE_ROLE_KEY!,
  db: process.env.SB_DB_URL!,
});
const opts = {auth: {persistSession: false, autoRefreshToken: false}};
export const admin = (): SupabaseClient => createClient(env().url, env().service, opts);
export const anon = (): SupabaseClient => createClient(env().url, env().anon, opts);

let pool: pg.Pool | null = null;
export const db = (): pg.Pool => (pool ??= new pg.Pool({connectionString: env().db, max: 20}));
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export const key = () => randomBytes(18).toString('base64url');
export const tag = () => `t${randomUUID().slice(0, 8)}`;
export const fakeIp = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

export function makeCtx(o: {monoUrl?: string; monoToken?: string; npUrl: string; telegramUrl?: string; mailer?: Mailer}): Ctx {
  return {
    db: admin(),
    np: {apiUrl: o.npUrl, apiKey: 'test', timeoutMs: 3000},
    mono: o.monoUrl ? {apiUrl: o.monoUrl, token: o.monoToken ?? 'test-mono-token', timeoutMs: 5000} : null,
    siteUrl: 'http://localhost:4180',
    // webhooks of the fake provider go to an in-test server (see payments.test.ts)
    webhookUrl: 'http://127.0.0.1:9/never',
    tokenSecret: 'test-token-secret',
    paymentValidityMinutes: 1440,
    allowedOrigins: [],
    jobsSecret: 'test-jobs-secret',
    telegram: o.telegramUrl ? {token: 'x', chatId: '1', apiUrl: o.telegramUrl} : null,
    supabaseUrl: 'http://127.0.0.1:55421',
    anonKey: 'test',
    adminUrl: 'http://localhost:4180/admin',
    mailer: o.mailer ?? null,
  };
}

// ── Fixtures (test-only data, clearly tagged; never part of the production seed) ──
export async function facetIds(group: string, slugs: string[]): Promise<number[]> {
  const r = await db().query('select id from facets where group_key = $1 and slug = any($2)', [group, slugs]);
  return r.rows.map(x => x.id);
}

export async function createItem(o: {
  name: string;
  kind?: 'product' | 'sample' | 'kit';
  category?: string;
  price_kop?: number | null;
  orderable?: boolean;
  status?: 'draft' | 'published';
  facets?: Record<string, string[]>;
  components?: {id: string; qty: number}[];
}): Promise<string> {
  const kind = o.kind ?? 'product';
  const slug = `test-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`.replace(/-+/g, '-').replace(/-$/, '');
  const r = await db().query(
    `insert into items (kind, category_id, slug, name, volume, price_kop, status, orderable)
     values ($1, (select id from categories where slug = $2), $3, $4, '50 мл', $5, $6, $7) returning id`,
    [kind, o.category ?? (kind === 'kit' ? 'nabory' : kind === 'sample' ? 'probnyky' : 'kremy'), slug, o.name,
     kind === 'kit' ? null : o.price_kop ?? 10000, o.status ?? 'published', o.orderable ?? true],
  );
  const id = r.rows[0].id as string;
  for (const [group, slugs] of Object.entries(o.facets ?? {})) {
    for (const f of await facetIds(group, slugs)) await db().query('insert into item_facets values ($1, $2)', [id, f]);
  }
  for (const [i, c] of (o.components ?? []).entries()) {
    await db().query('insert into kit_components (kit_id, product_id, qty, sort) values ($1, $2, $3, $4)', [id, c.id, c.qty, i]);
  }
  return id;
}

export function checkoutBody(lines: {id: string; qty: number}[], extra: Record<string, unknown> = {}) {
  return {
    idempotency_key: key(),
    payment_method: 'full_online',
    lines,
    customer: {first_name: 'Олена', last_name: 'Тестова', phone: `067${Math.floor(1000000 + Math.random() * 8999999)}`, email: '', comment: ''},
    delivery: {method: 'np_branch', settlement_ref: NP_FIX.kyiv.settlement, city_ref: NP_FIX.kyiv.city, warehouse_ref: NP_POINTS.kyivBranch1},
    consent: true,
    ...extra,
  };
}

export async function checkout(ctx: Ctx, body: unknown, ip = fakeIp()): Promise<{status: number; data: any}> {
  const res = await handleCheckout(
    new Request('http://local/checkout', {method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': ip}, body: JSON.stringify(body)}),
    ctx,
  );
  return {status: res.status, data: await res.json()};
}

export async function guest(ctx: Ctx, body: unknown, ip = fakeIp()): Promise<{status: number; data: any}> {
  const res = await handleOrder(
    new Request('http://local/order', {method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': ip}, body: JSON.stringify(body)}),
    ctx,
  );
  return {status: res.status, data: await res.json()};
}

export async function orderRow(id: string) {
  return (await db().query('select * from orders where id = $1', [id])).rows[0];
}
