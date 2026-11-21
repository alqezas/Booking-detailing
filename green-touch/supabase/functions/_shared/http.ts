/** HTTP helpers shared by the Edge Functions. */
import type {SupabaseClient} from '@supabase/supabase-js';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(code);
  }
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && (allowed.length === 0 || allowed.includes(origin));
  return {
    'access-control-allow-origin': ok ? origin : allowed[0] ?? '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers},
  });
}

export function errorResponse(e: unknown, headers: Record<string, string> = {}): Response {
  if (e instanceof ApiError) return json({error: e.code, details: e.details ?? null}, e.status, headers);
  // Never echo internals (could contain data); log only the message class.
  console.error('internal error:', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
  return json({error: 'INTERNAL'}, 500, headers);
}

/** Client IP from the platform proxy headers (falls back to a constant bucket). */
export function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (xf || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown').slice(0, 64);
}

export async function rateLimit(db: SupabaseClient, bucket: string, max: number, windowS: number): Promise<void> {
  const {data, error} = await db.rpc('svc_rate_limit', {p_bucket: bucket, p_max: max, p_window_s: windowS});
  if (error) throw error;
  if (data !== true) throw new ApiError('RATE_LIMITED', 429);
}

/** Map a Postgres RAISE (message = code) from a svc_* RPC to an ApiError. */
export function dbError(error: {message?: string; details?: string | null; code?: string}): ApiError | Error {
  const known: Record<string, number> = {
    IDEMPOTENCY_MISMATCH: 409,
    ITEM_UNAVAILABLE: 409,
    PRICE_CHANGED: 409,
    ORDER_NOT_FOUND: 404,
    ORDER_CANCELLED: 409,
    EMPTY_CART: 400,
    CART_TOO_LARGE: 400,
    BAD_QTY: 400,
    PAYMENT_METHOD_UNAVAILABLE: 409,
    NOT_ONLINE_PAYMENT: 409,
  };
  const code = error.message ?? '';
  if (code in known) {
    let details: unknown = null;
    try {
      details = error.details ? JSON.parse(error.details) : null;
    } catch {
      details = null;
    }
    return new ApiError(code, known[code], details);
  }
  return new Error(`db: ${code.slice(0, 120)}`);
}

export async function readJson(req: Request, maxBytes = 32_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError('PAYLOAD_TOO_LARGE', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('BAD_REQUEST', 400);
  }
}

export async function withRetry<T>(fn: () => Promise<T>, opts: {tries: number; baseMs: number; retryable: (e: unknown) => boolean}): Promise<T> {
  let last: unknown;
  for (let i = 0; i < opts.tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === opts.tries - 1 || !opts.retryable(e)) break;
      await new Promise(r => setTimeout(r, opts.baseMs * 2 ** i + Math.random() * opts.baseMs));
    }
  }
  throw last;
}
