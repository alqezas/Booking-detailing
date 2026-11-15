/**
 * Request handlers of the public functions. Pure functions of (request, ctx) so
 * Vitest runs the same code in Node against the local database.
 */
import {z} from 'zod';
import {checkoutRequestSchema, type DeliveryMethod} from './contracts.ts';
import type {Ctx} from './ctx.ts';
import {byteaHex, canonicalJson, hmacSha256, sha256, timingSafeEqual, toBase64Url, toHex} from './crypto.ts';
import {ApiError, clientIp, corsHeaders, dbError, errorResponse, json, rateLimit, readJson} from './http.ts';
import {decodeData, liqpayStatusSchema, verify} from './liqpay.ts';
import {searchSettlements, searchWarehouses, verifyWarehouse} from './np.ts';
import {applyStatus, reconcileAttempt, reconcileOrder, startPayment} from './payments.ts';

/** Same idempotency key → same token, so a retried request gets a working link. */
async function guestToken(ctx: Ctx, key: string): Promise<{token: string; hash: Uint8Array}> {
  const token = toBase64Url(await hmacSha256(ctx.tokenSecret, `order-token:${key}`));
  return {token, hash: await sha256(token)};
}

function wrap(ctx: Ctx, req: Request, fn: () => Promise<Response>): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), ctx.allowedOrigins);
  if (req.method === 'OPTIONS') return Promise.resolve(new Response('ok', {headers: cors}));
  if (req.method !== 'POST') return Promise.resolve(json({error: 'METHOD_NOT_ALLOWED'}, 405, cors));
  return fn()
    .then(res => {
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    })
    .catch(e => errorResponse(e, cors));
}

// ── checkout ─────────────────────────────────────────────────────────────────
export function handleCheckout(req: Request, ctx: Ctx): Promise<Response> {
  return wrap(ctx, req, async () => {
    const parsed = checkoutRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      // one message per field: the first rule that failed
      const fields = new Map<string, string>();
      for (const i of parsed.error.issues) if (!fields.has(i.path.join('.'))) fields.set(i.path.join('.'), i.message);
      throw new ApiError('BAD_REQUEST', 400, {fields: [...fields].map(([path, message]) => ({path, message}))});
    }
    const body = parsed.data;
    const ip = clientIp(req);
    await rateLimit(ctx.db, `checkout:ip:${ip}`, 12, 600);
    await rateLimit(ctx.db, `checkout:phone:${body.customer.phone}`, 8, 600);

    // The point must exist, be of the chosen type and belong to the chosen city.
    const np = await verifyWarehouse(ctx.np, body.delivery);

    // Fingerprint of what was ordered: a reused key with other content is rejected.
    const lines = [...body.lines].sort((a, b) => a.id.localeCompare(b.id));
    const requestHash = toHex(await sha256(canonicalJson({lines, customer: body.customer, delivery: body.delivery})));
    const {token, hash} = await guestToken(ctx, body.idempotency_key);

    const payload = {
      idempotency_key: body.idempotency_key,
      lines,
      customer: body.customer,
      delivery: {
        method: body.delivery.method,
        settlement_ref: body.delivery.settlement_ref,
        city_ref: body.delivery.city_ref,
        warehouse_ref: np.warehouse.ref,
        warehouse_number: np.warehouse.number,
        warehouse_name: np.warehouse.name,
        warehouse_type_ref: np.warehouse.type_ref,
        settlement_name: np.settlementName,
        area: np.area,
      },
      ...(body.expected_total_kop !== undefined ? {expected_total_kop: body.expected_total_kop} : {}),
    };
    const {data, error} = await ctx.db.rpc('svc_create_order', {
      p: payload,
      p_request_hash: requestHash,
      p_token_hash: byteaHex(hash),
    });
    if (error) throw dbError(error);
    const order = data as {order_id: string; number: number; total_kop: number; existing: boolean};

    // The order is saved; a payment failure must not lose it.
    let payment;
    try {
      payment = await startPayment(ctx, order.order_id);
    } catch (e) {
      console.error('start payment failed:', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
      payment = {state: 'unavailable' as const};
    }
    return json({...order, token, payment});
  });
}

// ── guest order status / pay again ───────────────────────────────────────────
const orderRequestSchema = z.object({
  order_id: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  action: z.enum(['status', 'pay']).default('status'),
});

type GuestOrder = {
  payment_status: string;
  open_attempt: {status: string; created_at: string} | null;
} & Record<string, unknown>;

export function handleOrder(req: Request, ctx: Ctx): Promise<Response> {
  return wrap(ctx, req, async () => {
    const parsed = orderRequestSchema.safeParse(await readJson(req, 4000));
    if (!parsed.success) throw new ApiError('BAD_REQUEST', 400);
    const {order_id, token, action} = parsed.data;
    await rateLimit(ctx.db, `order:ip:${clientIp(req)}`, 120, 600);
    const hash = byteaHex(await sha256(token));
    const read = async () => {
      const {data, error} = await ctx.db.rpc('svc_order_for_guest', {p_order: order_id, p_token_hash: hash});
      if (error) throw dbError(error);
      if (!data) throw new ApiError('ORDER_NOT_FOUND', 404);
      return data as GuestOrder;
    };
    let order = await read();

    if (action === 'pay') {
      await rateLimit(ctx.db, `pay:${order_id}`, 6, 600);
      const payment = await startPayment(ctx, order_id);
      return json({order: await read(), payment});
    }

    // Callback late or lost: ask LiqPay directly (at most once per 20 s per order).
    const open = order.open_attempt;
    if (open && Date.now() - Date.parse(open.created_at) > 60_000) {
      const {data: allowed} = await ctx.db.rpc('svc_rate_limit', {p_bucket: `reconcile:${order_id}`, p_max: 1, p_window_s: 20});
      if (allowed === true) {
        await reconcileOrder(ctx, order_id);
        order = await read();
      }
    }
    return json({order});
  });
}

// ── Nova Poshta lookup proxy (API key stays on the server) ───────────────────
const npRequestSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('settlements'), q: z.string().max(60), page: z.number().int().min(1).max(20).default(1)}),
  z.object({
    action: z.literal('warehouses'),
    city_ref: z.uuid(),
    method: z.enum(['np_branch', 'np_postomat']),
    q: z.string().max(60).default(''),
    cursor: z.string().max(20).nullable().default(null),
  }),
]);

export function handleNp(req: Request, ctx: Ctx): Promise<Response> {
  return wrap(ctx, req, async () => {
    const parsed = npRequestSchema.safeParse(await readJson(req, 2000));
    if (!parsed.success) throw new ApiError('BAD_REQUEST', 400);
    await rateLimit(ctx.db, `np:ip:${clientIp(req)}`, 240, 600);
    const r = parsed.data;
    if (r.action === 'settlements') return json(await searchSettlements(ctx.np, r.q, r.page));
    return json(await searchWarehouses(ctx.np, {cityRef: r.city_ref, method: r.method as DeliveryMethod, query: r.q, cursor: r.cursor}));
  });
}

// ── LiqPay callback: no user JWT, authenticated by the signature over `data` ─
export async function handleLiqPayCallback(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method !== 'POST') return json({error: 'METHOD_NOT_ALLOWED'}, 405);
  if (!ctx.liqpay) return json({error: 'NOT_CONFIGURED'}, 503);
  const raw = await req.text();
  if (raw.length > 32_000) return json({error: 'PAYLOAD_TOO_LARGE'}, 413);
  const form = new URLSearchParams(raw);
  const data = form.get('data') ?? '';
  // The signature covers the exact base64 `data` received; decode only after it verifies.
  if (!verify(ctx.liqpay, data, form.get('signature') ?? '')) {
    console.warn('liqpay callback: bad signature');
    return json({error: 'BAD_SIGNATURE'}, 401);
  }
  let body: unknown;
  try {
    body = decodeData(data);
  } catch {
    return json({error: 'BAD_REQUEST'}, 400);
  }
  const s = liqpayStatusSchema.safeParse(body);
  if (!s.success) return json({error: 'BAD_REQUEST'}, 400);
  if (s.data.public_key && s.data.public_key !== ctx.liqpay.publicKey) return json({error: 'WRONG_MERCHANT'}, 400);
  try {
    const outcome = await applyStatus(ctx, s.data, 'callback');
    // 200 for duplicates/mismatches too: the event is recorded, a retry won't help.
    return json({ok: true, outcome});
  } catch (e) {
    return errorResponse(e); // 500 → LiqPay may retry; reconciliation covers the rest
  }
}

// ── background jobs (pg_cron → pg_net → here) ───────────────────────────────
export type JobsReport = {reconciled: number; outbox: {done: number; failed: number}};

type OutboxRow = {id: number; topic: string; order_id: string | null; payload: Record<string, unknown>; attempts: number};

async function deliverTelegram(ctx: Ctx, row: OutboxRow): Promise<void> {
  if (!ctx.telegram || !['order.paid', 'payment.needs_review'].includes(row.topic) || !row.order_id) return;
  const {data: done} = await ctx.db.from('outbox_effects').select('outbox_id').eq('outbox_id', row.id).eq('consumer', 'telegram').maybeSingle();
  if (done) return;
  const {data: o} = await ctx.db.from('orders').select('number,total_kop').eq('id', row.order_id).single();
  const text =
    row.topic === 'order.paid'
      ? `Green Touch: оплачене замовлення №${o?.number}, ${((o?.total_kop ?? 0) / 100).toFixed(2)} грн`
      : `Green Touch: замовлення №${o?.number} потребує перевірки (${String(row.payload.reason ?? '')})`;
  const res = await fetch(`${ctx.telegram.apiUrl}/bot${ctx.telegram.token}/sendMessage`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({chat_id: ctx.telegram.chatId, text}),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`telegram http ${res.status}`);
  // At-least-once: a crash right here may resend once; the effect row stops further repeats.
  await ctx.db.rpc('svc_record_effect', {p_id: row.id, p_consumer: 'telegram'});
}

/** Outbox consumers. Each is idempotent per (event, consumer). */
async function consume(ctx: Ctx, row: OutboxRow): Promise<void> {
  const t = await ctx.db.rpc('svc_record_timeline', {p_outbox: row.id});
  if (t.error) throw new Error(`timeline: ${t.error.message}`);
  await deliverTelegram(ctx, row);
}

export async function processOutbox(ctx: Ctx, worker: string, limit = 20): Promise<{done: number; failed: number}> {
  const {data, error} = await ctx.db.rpc('svc_claim_outbox', {p_worker: worker, p_limit: limit, p_lease_s: 60});
  if (error) throw dbError(error);
  let done = 0;
  let failed = 0;
  for (const row of (data ?? []) as OutboxRow[]) {
    try {
      await consume(ctx, row);
      await ctx.db.rpc('svc_complete_outbox', {p_id: row.id, p_worker: worker});
      done++;
    } catch (e) {
      failed++;
      await ctx.db.rpc('svc_fail_outbox', {p_id: row.id, p_worker: worker, p_error: e instanceof Error ? e.message : 'unknown'});
    }
  }
  return {done, failed};
}

export async function runJobs(ctx: Ctx, worker: string): Promise<JobsReport> {
  let reconciled = 0;
  if (ctx.liqpay) {
    const {data, error} = await ctx.db.rpc('svc_claim_payment_checks', {p_limit: 20});
    if (error) throw dbError(error);
    for (const a of (data ?? []) as {provider_order_id: string; expires_at: string}[]) {
      try {
        await reconcileAttempt(ctx, a.provider_order_id, a.expires_at);
        reconciled++;
      } catch (e) {
        console.warn('reconcile failed:', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
      }
    }
  }
  const outbox = await processOutbox(ctx, worker);
  return {reconciled, outbox};
}

export async function handleJobs(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method !== 'POST') return json({error: 'METHOD_NOT_ALLOWED'}, 405);
  const given = req.headers.get('x-jobs-secret') ?? '';
  if (!ctx.jobsSecret || !timingSafeEqual(given, ctx.jobsSecret)) return json({error: 'FORBIDDEN'}, 403);
  try {
    return json(await runJobs(ctx, `edge-${crypto.randomUUID().slice(0, 8)}`));
  } catch (e) {
    return errorResponse(e);
  }
}
