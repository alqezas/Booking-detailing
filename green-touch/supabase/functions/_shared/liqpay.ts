/**
 * LiqPay internet acquiring (https://www.liqpay.ua/en/doc/api/internet_acquiring/checkout).
 * - Checkout: the browser POSTs `data` + `signature` to https://www.liqpay.ua/api/3/checkout.
 * - data = base64(JSON), signature = base64(sha3-256(private_key + data + private_key)).
 *   (Older merchant accounts may still use sha1 — set LIQPAY_SIGNATURE_ALGO=sha1.)
 * - Callback to server_url: POST form fields `data` and `signature`, same formula.
 * - Status: POST https://www.liqpay.ua/api/request with action=status, order_id.
 * order_id must be unique per payment, so we use one per payment attempt.
 * SHA3 is not in Web Crypto; @noble/hashes runs the same in Deno and Node.
 */
import {sha1} from '@noble/hashes/legacy';
import {sha3_256} from '@noble/hashes/sha3';
import {z} from 'zod';
import {fromBase64, timingSafeEqual, toBase64} from './crypto.ts';
import {withRetry} from './http.ts';

export type LiqPayConfig = {
  publicKey: string;
  privateKey: string;
  apiUrl: string; // https://www.liqpay.ua
  /** where the browser posts the form; defaults to apiUrl + /api/3/checkout */
  checkoutUrl?: string;
  algo: 'sha3-256' | 'sha1';
  sandbox: boolean;
  timeoutMs?: number;
};

const enc = new TextEncoder();

export function sign(cfg: LiqPayConfig, data: string): string {
  const input = enc.encode(cfg.privateKey + data + cfg.privateKey);
  return toBase64(cfg.algo === 'sha1' ? sha1(input) : sha3_256(input));
}

export const encodeData = (params: Record<string, unknown>) => toBase64(enc.encode(JSON.stringify(params)));
export const decodeData = (data: string): unknown => JSON.parse(new TextDecoder().decode(fromBase64(data)));

/** Signature check over the exact `data` string received. */
export function verify(cfg: LiqPayConfig, data: string, signature: string): boolean {
  if (!data || !signature || data.length > 20_000 || signature.length > 200) return false;
  return timingSafeEqual(sign(cfg, data), signature.trim());
}

/** "YYYY-MM-DD HH:MM:SS" in UTC, as LiqPay expects for expired_date. */
const liqpayDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export function checkoutPayload(
  cfg: LiqPayConfig,
  input: {amountKop: number; orderId: string; description: string; resultUrl: string; serverUrl: string; expiresAt: Date},
): {data: string; signature: string} {
  const params = {
    version: 3,
    public_key: cfg.publicKey,
    action: 'pay',
    amount: (input.amountKop / 100).toFixed(2),
    currency: 'UAH',
    description: input.description,
    order_id: input.orderId,
    result_url: input.resultUrl,
    server_url: input.serverUrl,
    expired_date: liqpayDate(input.expiresAt),
    language: 'uk',
    ...(cfg.sandbox ? {sandbox: 1} : {}),
  };
  const data = encodeData(params);
  return {data, signature: sign(cfg, data)};
}

export const checkoutUrl = (cfg: LiqPayConfig) => cfg.checkoutUrl || `${cfg.apiUrl.replace(/\/$/, '')}/api/3/checkout`;

/** Fields we read from a callback / status response (everything else is ignored, card data never stored). */
export const liqpayStatusSchema = z.object({
  status: z.string().min(1).max(40),
  order_id: z.string().min(1).max(255),
  amount: z.union([z.number(), z.string()]).optional(),
  currency: z.string().max(5).optional(),
  payment_id: z.union([z.number(), z.string()]).optional(),
  end_date: z.number().optional(),
  create_date: z.number().optional(),
  err_code: z.string().max(100).optional(),
  err_description: z.string().max(500).optional(),
  public_key: z.string().max(100).optional(),
});
export type LiqPayStatus = z.infer<typeof liqpayStatusSchema>;

const FINAL_FAIL = new Set(['failure', 'error']);
const PROCESSING = new Set([
  '3ds_verify', 'captcha_verify', 'cvv_verify', 'ivr_verify', 'otp_verify', 'password_verify', 'phone_verify', 'pin_verify',
  'senderapp_verify', 'wait_qr', 'wait_sender', 'cash_wait', 'hold_wait', 'invoice_wait', 'prepared', 'processing',
  'wait_accept', 'wait_card', 'wait_compensation', 'wait_lc', 'wait_reserve', 'wait_secure',
]);

/** LiqPay status → our normalized status. `sandbox` counts as paid only in sandbox mode. */
export function normalizeStatus(cfg: LiqPayConfig, status: string): 'success' | 'failure' | 'reversed' | 'processing' | null {
  if (status === 'success') return 'success';
  if (status === 'sandbox') return cfg.sandbox ? 'success' : null;
  if (status === 'reversed') return 'reversed';
  if (FINAL_FAIL.has(status)) return 'failure';
  if (PROCESSING.has(status)) return 'processing';
  return null; // unknown / subscription statuses: recorded, not applied
}

/** One provider status as the database applies it. Same dedupe key for callback and status request. */
export function toEvent(cfg: LiqPayConfig, s: LiqPayStatus, source: 'callback' | 'reconcile') {
  const status = normalizeStatus(cfg, s.status);
  const amount = s.amount == null ? null : Math.round(Number(s.amount) * 100);
  const ts = s.end_date ?? s.create_date;
  return {
    status,
    event: {
      dedupe_key: `${s.order_id}:${s.status}:${s.payment_id ?? ''}`,
      source,
      provider_order_id: s.order_id,
      provider_status: s.status,
      status: status ?? 'processing',
      amount_kop: amount,
      currency: s.currency ?? null,
      payment_id: s.payment_id == null ? null : String(s.payment_id),
      modified_at: ts ? new Date(ts).toISOString() : null,
      failure_reason: s.err_description ?? s.err_code ?? null,
    },
  };
}

export class LiqPayError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Ask LiqPay for the current status of one payment. Returns null when LiqPay does not know the order (never paid). */
export async function requestStatus(cfg: LiqPayConfig, orderId: string): Promise<LiqPayStatus | null> {
  const data = encodeData({action: 'status', version: 3, public_key: cfg.publicKey, order_id: orderId});
  const body = new URLSearchParams({data, signature: sign(cfg, data)});
  const res = await withRetry(
    async () => {
      let r: Response;
      try {
        r = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/api/request`, {
          method: 'POST',
          headers: {'content-type': 'application/x-www-form-urlencoded'},
          body,
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
        });
      } catch {
        throw new LiqPayError('network', true);
      }
      if (r.status >= 500 || r.status === 429) throw new LiqPayError(`http_${r.status}`, true);
      if (!r.ok) throw new LiqPayError(`http_${r.status}`, false);
      return (await r.json().catch(() => null)) as Record<string, unknown> | null;
    },
    {tries: 3, baseMs: 400, retryable: e => e instanceof LiqPayError && e.retryable},
  );
  if (!res) throw new LiqPayError('bad_json', false);
  if (res.result === 'error' && !res.status) {
    if (res.err_code === 'payment_not_found' || res.err_code === 'order_not_found') return null;
    throw new LiqPayError(String(res.err_code ?? 'error').slice(0, 60), false);
  }
  const parsed = liqpayStatusSchema.safeParse(res);
  if (!parsed.success) throw new LiqPayError('bad_status_response', false);
  if (parsed.data.status === 'error' && (parsed.data.err_code === 'payment_not_found' || parsed.data.err_code === 'order_not_found')) return null;
  return parsed.data;
}
