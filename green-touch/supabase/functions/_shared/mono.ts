/**
 * plata by mono acquiring (https://api.monobank.ua/docs/acquiring.html).
 * - POST /api/merchant/invoice/create   (X-Token) → {invoiceId, pageUrl}
 * - GET  /api/merchant/invoice/status?invoiceId=…  → status, amount, ccy, modifiedDate…
 * - POST /api/merchant/invoice/remove   → invalidate an unpaid invoice
 * - GET  /api/merchant/pubkey           → base64(PEM) ECDSA key for X-Sign
 * Webhooks carry the same body as the status call, signed in X-Sign; order is not
 * guaranteed (use modifiedDate) and `expired` is not sent (reconciliation finds it).
 * The buyer pays on mono's own page (pageUrl): card data never touches our site.
 */
import {z} from 'zod';
import {verifyEcdsaSignature} from './crypto.ts';
import {withRetry} from './http.ts';

export type MonoConfig = {apiUrl: string; token: string; timeoutMs?: number};

export const monoStatusSchema = z.object({
  invoiceId: z.string().min(1).max(100),
  status: z.enum(['created', 'processing', 'hold', 'success', 'failure', 'reversed', 'expired']),
  amount: z.number().int(),
  ccy: z.number().int(),
  finalAmount: z.number().int().optional(),
  failureReason: z.string().max(500).optional(),
  modifiedDate: z.string().min(10).max(40),
  reference: z.string().max(100).optional(),
});
export type MonoStatus = z.infer<typeof monoStatusSchema>;

export class MonoError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

async function request(cfg: MonoConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(cfg.apiUrl.replace(/\/$/, '') + path, {
      method,
      headers: {'x-token': cfg.token, 'content-type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
    });
  } catch {
    throw new MonoError('network', true);
  }
  const text = await res.text();
  if (!res.ok) {
    // Error bodies are {errCode, errText}; they never contain card data.
    let code = `http_${res.status}`;
    try {
      code = (JSON.parse(text) as {errCode?: string}).errCode ?? code;
    } catch {
      /* not json */
    }
    throw new MonoError(code, res.status >= 500 || res.status === 429);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new MonoError('bad_json', false);
  }
}

export async function createInvoice(
  cfg: MonoConfig,
  input: {amountKop: number; reference: string; destination: string; redirectUrl: string; webhookUrl: string; validityS: number},
): Promise<{invoiceId: string; pageUrl: string}> {
  const body = {
    amount: input.amountKop,
    ccy: 980,
    merchantPaymInfo: {reference: input.reference, destination: input.destination},
    redirectUrl: input.redirectUrl,
    webHookUrl: input.webhookUrl,
    validity: input.validityS,
    paymentType: 'debit',
  };
  // Limited retries with backoff only for network/5xx. A duplicate unpaid invoice
  // at mono is harmless: we never show its URL and it expires on its own.
  const res = await withRetry(() => request(cfg, 'POST', '/api/merchant/invoice/create', body), {
    tries: 3,
    baseMs: 400,
    retryable: e => e instanceof MonoError && e.retryable,
  });
  const parsed = z.object({invoiceId: z.string().min(1), pageUrl: z.url()}).safeParse(res);
  if (!parsed.success) throw new MonoError('bad_create_response', false);
  return parsed.data;
}

export async function invoiceStatus(cfg: MonoConfig, invoiceId: string): Promise<MonoStatus> {
  const res = await withRetry(() => request(cfg, 'GET', `/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`), {
    tries: 3,
    baseMs: 400,
    retryable: e => e instanceof MonoError && e.retryable,
  });
  return monoStatusSchema.parse(res);
}

export async function removeInvoice(cfg: MonoConfig, invoiceId: string): Promise<void> {
  await request(cfg, 'POST', '/api/merchant/invoice/remove', {invoiceId}).catch(e => {
    // Already paid/expired invoices cannot be removed; reconciliation records their state.
    console.warn('mono remove failed:', e instanceof MonoError ? e.message : 'unknown');
  });
}

let pubKeyCache: {key: string; at: number} | null = null;
export const resetMonoKeyCache = () => {
  pubKeyCache = null;
};

async function pubKey(cfg: MonoConfig, fresh: boolean): Promise<string> {
  if (!fresh && pubKeyCache && Date.now() - pubKeyCache.at < 24 * 3600_000) return pubKeyCache.key;
  const res = (await request(cfg, 'GET', '/api/merchant/pubkey')) as {key?: string};
  if (!res.key) throw new MonoError('no_pubkey', true);
  pubKeyCache = {key: res.key, at: Date.now()};
  return res.key;
}

/** Verify X-Sign over the raw body; refetch the key once in case mono rotated it. */
export async function verifyWebhook(cfg: MonoConfig, rawBody: Uint8Array, xSign: string | null): Promise<boolean> {
  if (!xSign || xSign.length > 400) return false;
  if (await verifyEcdsaSignature(await pubKey(cfg, false), rawBody, xSign)) return true;
  return verifyEcdsaSignature(await pubKey(cfg, true), rawBody, xSign);
}

/** One provider status as the database applies it. Same dedupe key for webhook and reconciliation. */
export function toEvent(s: MonoStatus, source: 'webhook' | 'reconcile') {
  return {
    dedupe_key: `${s.invoiceId}:${s.status}:${s.modifiedDate}`,
    source,
    provider_order_id: s.invoiceId,
    provider_status: s.status,
    status: s.status,
    amount_kop: s.amount,
    currency: String(s.ccy),
    modified_at: s.modifiedDate,
    failure_reason: s.failureReason ?? null,
  };
}
