/**
 * Payment orchestration (LiqPay). Database steps are short transactions.
 *   begin_payment (lock order, guard against a second live payment)
 *   → sign the checkout payload (no network) → attach_checkout
 * A crash between the two leaves a 'creating' attempt; the next begin_payment
 * marks it abandoned after 45 s and prepares a new one (the unsaved payload was
 * never shown to the buyer, so it cannot be paid).
 * The browser then POSTs data+signature to LiqPay; the redirect back proves
 * nothing — only a verified callback or a status request changes the order.
 */
import type {Ctx} from './ctx.ts';
import {dbError} from './http.ts';
import {checkoutPayload, checkoutUrl, requestStatus, toEvent, type LiqPayStatus} from './liqpay.ts';

export type Checkout = {url: string; data: string; signature: string};
export type PaymentStart = {state: 'redirect'; checkout: Checkout} | {state: 'paid' | 'processing' | 'in_progress' | 'unavailable'};

type Begin =
  | {state: 'paid' | 'processing' | 'in_progress'}
  | {state: 'existing'; data: string; signature: string}
  | {state: 'new'; attempt_id: string; amount_kop: number; number: number; provider_order_id: string; expires_at: string};

export async function startPayment(ctx: Ctx, orderId: string): Promise<PaymentStart> {
  if (!ctx.liqpay) return {state: 'unavailable'};
  const {data, error} = await ctx.db.rpc('svc_begin_payment', {p_order: orderId, p_validity_minutes: ctx.paymentValidityMinutes});
  if (error) throw dbError(error);
  const b = data as Begin;
  const url = checkoutUrl(ctx.liqpay);
  if (b.state === 'existing') return {state: 'redirect', checkout: {url, data: b.data, signature: b.signature}};
  if (b.state !== 'new') return {state: b.state};

  let payload: {data: string; signature: string};
  try {
    payload = checkoutPayload(ctx.liqpay, {
      amountKop: b.amount_kop,
      orderId: b.provider_order_id,
      description: `Оплата замовлення №${b.number}, Green Touch`,
      resultUrl: `${ctx.siteUrl}/zamovlennia/${orderId}`,
      serverUrl: ctx.callbackUrl,
      expiresAt: new Date(b.expires_at),
    });
  } catch (e) {
    await ctx.db.rpc('svc_fail_attempt', {p_attempt: b.attempt_id, p_error: e instanceof Error ? e.message : 'sign failed'});
    return {state: 'unavailable'};
  }
  const att = await ctx.db.rpc('svc_attach_checkout', {p_attempt: b.attempt_id, p_data: payload.data, p_signature: payload.signature});
  if (att.error) throw dbError(att.error);
  if ((att.data as {state: string}).state !== 'created') return {state: 'in_progress'};
  return {state: 'redirect', checkout: {url, ...payload}};
}

export async function applyStatus(ctx: Ctx, s: LiqPayStatus, source: 'callback' | 'reconcile'): Promise<string> {
  const {status, event} = toEvent(ctx.liqpay!, s, source);
  if (!status) return 'ignored_status';
  const {data, error} = await ctx.db.rpc('svc_apply_payment_event', {p: event});
  if (error) throw dbError(error);
  return data as string;
}

/** Ask LiqPay for one payment's status and apply it. An unknown payment past its validity is expired. */
export async function reconcileAttempt(ctx: Ctx, providerOrderId: string, expiresAt: string): Promise<string> {
  if (!ctx.liqpay) return 'not_configured';
  const s = await requestStatus(ctx.liqpay, providerOrderId);
  if (s) return applyStatus(ctx, s, 'reconcile');
  if (Date.parse(expiresAt) < Date.now()) {
    const {data, error} = await ctx.db.rpc('svc_apply_payment_event', {
      p: {dedupe_key: `${providerOrderId}:expired`, source: 'reconcile', provider_order_id: providerOrderId, provider_status: 'not_found_after_expiry', status: 'expired'},
    });
    if (error) throw dbError(error);
    return data as string;
  }
  return 'not_started';
}

/** Reconcile every open payment of an order (used when the buyer looks at the status page). */
export async function reconcileOrder(ctx: Ctx, orderId: string): Promise<void> {
  const {data, error} = await ctx.db.rpc('svc_order_attempts', {p_order: orderId});
  if (error) throw dbError(error);
  for (const a of (data ?? []) as {provider_order_id: string; expires_at: string}[]) {
    await reconcileAttempt(ctx, a.provider_order_id, a.expires_at).catch(e => console.warn('reconcile failed:', e instanceof Error ? e.message : 'unknown'));
  }
}
