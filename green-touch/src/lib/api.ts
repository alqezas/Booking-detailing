/**
 * Public API: catalog reads go to PostgREST RPCs as GET (so the service worker
 * may keep a bounded copy); checkout, order status and Nova Poshta
 * go to Edge Functions. Errors carry the server code; texts are Ukrainian.
 */
import {
  ERROR_TEXT,
  catalogRpcArgs,
  type CatalogQuery,
  type CheckoutRequest,
  type DeliveryMethod,
  type NpSettlement,
  type NpWarehouse,
} from '../../supabase/functions/_shared/contracts.ts';
import {env} from './env.ts';
import {publicClient} from './supabase.ts';
import type {CatalogMeta, GuestOrder, ItemDetail, PaymentStart, Quote, SearchResult} from './types.ts';

const EXTRA_TEXT: Record<string, string> = {
  OFFLINE: 'Немає зʼєднання з інтернетом. Перевірте мережу.',
  NETWORK: 'Не вдалося звʼязатися із сервером. Спробуйте ще раз.',
};

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number | null,
    public details: unknown = null,
  ) {
    super(EXTRA_TEXT[code] ?? ERROR_TEXT[code] ?? ERROR_TEXT.INTERNAL!);
  }
}

async function rpcGet<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // GET puts args in the query string: omit nulls (the SQL defaults apply) instead of sending "null".
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== undefined));
  const {data, error, status} = await publicClient.rpc(fn, clean, {get: true});
  if (error) throw new ApiError(status === 0 ? 'NETWORK' : 'INTERNAL', status ?? null);
  return data as T;
}

export const getMeta = () => rpcGet<CatalogMeta>('catalog_meta');
export const searchCatalog = (q: CatalogQuery) => rpcGet<SearchResult>('catalog_search', catalogRpcArgs(q));
export const getItem = (slug: string) => rpcGet<ItemDetail | null>('catalog_item', {p_slug: slug});
export const getPage = (slug: string) =>
  rpcGet<{slug: string; title: string; body: string; needs_review: boolean; updated_at: string} | null>('public_page', {p_slug: slug});

export async function quoteCart(lines: {id: string; qty: number}[]): Promise<Quote> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('OFFLINE', null);
  const {data, error, status} = await publicClient.rpc('quote_cart', {p_lines: lines});
  if (error) throw new ApiError(status === 0 ? 'NETWORK' : 'INTERNAL', status ?? null);
  return data as Quote;
}

async function fn<T>(name: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('OFFLINE', null);
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {'content-type': 'application/json', apikey: env.anonKey, authorization: `Bearer ${env.anonKey}`},
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', null);
  }
  const data = (await res.json().catch(() => null)) as {error?: string; details?: unknown} | null;
  if (!res.ok) throw new ApiError(data?.error ?? 'INTERNAL', res.status, data?.details ?? null);
  return data as T;
}

export type CheckoutResponse = {order_id: string; number: number; total_kop: number; existing: boolean; token: string; payment: PaymentStart};
export const submitCheckout = (body: CheckoutRequest) => fn<CheckoutResponse>('checkout', body);
export const orderStatus = (order_id: string, token: string) => fn<{order: GuestOrder}>('order', {order_id, token, action: 'status'});
export const payAgain = (order_id: string, token: string) => fn<{order: GuestOrder; payment: PaymentStart}>('order', {order_id, token, action: 'pay'});

export const npSettlements = (q: string, signal?: AbortSignal) => fn<{items: NpSettlement[]; total: number}>('np', {action: 'settlements', q, page: 1}, signal);
export const npWarehouses = (city_ref: string, method: DeliveryMethod, q: string, signal?: AbortSignal) =>
  fn<{items: NpWarehouse[]; next: string | null}>('np', {action: 'warehouses', city_ref, method, q, cursor: null}, signal);
