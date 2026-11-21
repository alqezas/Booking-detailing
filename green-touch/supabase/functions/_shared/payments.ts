/**
 * Online payment orchestration (plata by mono). Database steps are short
 * transactions; the mono HTTP call happens between them, never inside one.
 *   begin_payment (lock order, guard against a second live invoice)
 *   → createInvoice (HTTP) → attach_invoice | fail_attempt
 * A crash between the two leaves a 'creating' attempt; the next begin_payment
 * marks it abandoned after 45 s and starts over (the orphan invoice URL was never
 * shown, so it cannot be paid). Only orders with payment_method = full_online pay here;
 * the 150 грн prepayment is arranged by the owner in Viber, outside the site.
 */
import type {Ctx} from './ctx.ts';
import {dbError} from './http.ts';
import {createInvoice, invoiceStatus, MonoError, removeInvoice, toEvent, type MonoStatus} from './mono.ts';

export type PaymentStart = {state: 'redirect'; page_url: string} | {state: 'paid' | 'processing' | 'in_progress' | 'unavailable'};

type Begin =
  | {state: 'paid' | 'processing' | 'in_progress'}
  | {state: 'existing'; page_url: string}
  | {state: 'new'; attempt_id: string; amount_kop: number; number: number; validity_s: number; cancel_invoice: string | null};

export async function startPayment(ctx: Ctx, orderId: string): Promise<PaymentStart> {
  if (!ctx.mono) return {state: 'unavailable'};
  const {data, error} = await ctx.db.rpc('svc_begin_payment', {p_order: orderId, p_validity_minutes: ctx.paymentValidityMinutes});
  if (error) throw dbError(error);
  const b = data as Begin;
  if (b.state === 'existing') return {state: 'redirect', page_url: b.page_url};
  if (b.state !== 'new') return {state: b.state};

  if (b.cancel_invoice) await removeInvoice(ctx.mono, b.cancel_invoice);

  let invoice: {invoiceId: string; pageUrl: string};
  try {
    invoice = await createInvoice(ctx.mono, {
      amountKop: b.amount_kop,
      reference: `GT-${b.number}`,
      destination: `Оплата замовлення №${b.number}, Green Touch`,
      redirectUrl: `${ctx.siteUrl}/zamovlennia/${orderId}`,
      webhookUrl: ctx.webhookUrl,
      validityS: b.validity_s,
    });
  } catch (e) {
    const msg = e instanceof MonoError ? e.message : 'unexpected';
    console.error('mono create failed:', msg);
    await ctx.db.rpc('svc_fail_attempt', {p_attempt: b.attempt_id, p_error: msg});
    return {state: 'unavailable'};
  }

  const att = await ctx.db.rpc('svc_attach_invoice', {p_attempt: b.attempt_id, p_invoice: invoice.invoiceId, p_page_url: invoice.pageUrl});
  if (att.error) {
    // The invoice exists at mono but we could not save it: invalidate it so it can't be paid unseen.
    await removeInvoice(ctx.mono, invoice.invoiceId);
    throw dbError(att.error);
  }
  if ((att.data as {state: string}).state === 'superseded') {
    await removeInvoice(ctx.mono, invoice.invoiceId);
    return {state: 'in_progress'};
  }
  return {state: 'redirect', page_url: invoice.pageUrl};
}

export async function applyStatus(ctx: Ctx, s: MonoStatus, source: 'webhook' | 'reconcile'): Promise<string> {
  const {data, error} = await ctx.db.rpc('svc_apply_payment_event', {p: toEvent(s, source)});
  if (error) throw dbError(error);
  return data as string;
}

/** Ask mono for the current status of one invoice and apply it. */
export async function reconcileInvoice(ctx: Ctx, invoiceId: string): Promise<string> {
  if (!ctx.mono) return 'not_configured';
  return applyStatus(ctx, await invoiceStatus(ctx.mono, invoiceId), 'reconcile');
}

/** Reconcile every open invoice of an order (used when the buyer looks at the status page). */
export async function reconcileOrder(ctx: Ctx, orderId: string): Promise<void> {
  const {data, error} = await ctx.db.rpc('svc_order_attempts', {p_order: orderId});
  if (error) throw dbError(error);
  for (const a of (data ?? []) as {invoice_id: string}[]) {
    await reconcileInvoice(ctx, a.invoice_id).catch(e => console.warn('reconcile failed:', e instanceof Error ? e.message : 'unknown'));
  }
}
