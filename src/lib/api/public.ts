import {toApiError} from '../errors.ts';
import {publicClient} from '../supabase.ts';
import type {TireParams, TireSource} from '../../../supabase/functions/_shared/tire.ts';
import type {Availability, PublicBooking, PublicTenant} from '../types.ts';

async function rpc<T>(fn: string, args: Record<string, unknown>, get = false): Promise<T> {
  const {data, error, status} = await publicClient.rpc(fn, args, {get});
  if (error) throw toApiError(error, status);
  return data as T;
}

// GET so the studio's service worker can keep the public card for offline use.
export const getTenant = (slug: string) => rpc<PublicTenant>('public_get_tenant', {p_slug: slug}, true);

export const getAvailability = (slug: string, serviceId: string, from: string, days: number) =>
  rpc<Availability>('public_get_availability', {p_slug: slug, p_service_id: serviceId, p_from: from, p_days: days});

export type CreateBookingInput = {
  slug: string;
  serviceId: string;
  startAt: string;
  name: string;
  phone: string;
  car: string;
  comment: string;
  idempotencyKey: string;
};

export const createBooking = (i: CreateBookingInput) =>
  rpc<{booking: PublicBooking; access_token: string; replayed: boolean}>('public_create_booking', {
    p_slug: i.slug,
    p_service_id: i.serviceId,
    p_start_at: i.startAt,
    p_customer_name: i.name,
    p_customer_phone: i.phone,
    p_car: i.car,
    p_comment: i.comment,
    p_idempotency_key: i.idempotencyKey,
  });

/** Tyre details sent with a calculator booking; the server recomputes the price. */
export type TireBookingInput = TireParams & {plate: string; tire_size: string; tire_source: TireSource};

export const getTireAvailability = (slug: string, serviceId: string, params: TireParams, from: string, days: number) =>
  rpc<Availability>('public_get_tire_availability', {p_slug: slug, p_service_id: serviceId, p_params: params, p_from: from, p_days: days});

export const createTireBooking = (i: CreateBookingInput & {tire: TireBookingInput}) =>
  rpc<{booking: PublicBooking; access_token: string; replayed: boolean}>('public_create_tire_booking', {
    p_slug: i.slug,
    p_service_id: i.serviceId,
    p_start_at: i.startAt,
    p_customer_name: i.name,
    p_customer_phone: i.phone,
    p_car: i.car,
    p_comment: i.comment,
    p_idempotency_key: i.idempotencyKey,
    p_tire: i.tire,
  });

export type StoredSetHint = {season: 'summer' | 'winter' | 'all'; tire_size: string; with_rims: boolean; stored_at: string};
/** Whether the studio keeps this customer's set: needs both their phone and plate. */
export const lookupTireStorage = (slug: string, phone: string, plate: string) =>
  rpc<StoredSetHint[]>('public_tire_storage_lookup', {p_slug: slug, p_phone: phone, p_plate: plate});

export const getBooking = (slug: string, token: string) => rpc<PublicBooking>('public_get_booking', {p_slug: slug, p_token: token});

export const cancelBooking = (slug: string, token: string, reason?: string) =>
  rpc<PublicBooking>('public_cancel_booking', {p_slug: slug, p_token: token, p_reason: reason ?? null});

export const savePushSubscription = (slug: string, token: string, sub: PushSubscriptionJSON) =>
  rpc<PublicBooking>('public_save_push_subscription', {
    p_slug: slug,
    p_token: token,
    p_endpoint: sub.endpoint,
    p_p256dh: sub.keys?.p256dh,
    p_auth: sub.keys?.auth,
  });
