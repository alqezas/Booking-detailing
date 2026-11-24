/**
 * Beauty studios: service options (add-ons) and studio opening state.
 *
 * addonsQuote() mirrors private.addons_quote in the beauty migration; the
 * SQL function is the source of truth for bookings (the client never sends a
 * price or a duration). The browser and the assistant use this copy for the
 * live preview and for answers, and tests keep both in step.
 */

export type AddonDef = {key: string; name: string; price: number; duration_minutes: number};
export type BeautyService = {id: string; name: string; price: number; price_from?: boolean; duration_minutes: number; addons?: AddonDef[]};

export type AddonsQuote = {
  price: number;
  price_from: boolean;
  duration_minutes: number;
  base_price: number;
  base_minutes: number;
  addons: AddonDef[];
  /** Keys that the service does not offer (rejected by the server). */
  unknown: string[];
};

export function addonsQuote(service: BeautyService, keys: readonly string[]): AddonsQuote {
  const wanted = [...new Set(keys)].sort();
  const offered = new Map((service.addons ?? []).map(a => [a.key, a]));
  const chosen = (service.addons ?? []).filter(a => wanted.includes(a.key));
  return {
    price: service.price + chosen.reduce((s, a) => s + a.price, 0),
    price_from: !!service.price_from,
    duration_minutes: service.duration_minutes + chosen.reduce((s, a) => s + a.duration_minutes, 0),
    base_price: service.price,
    base_minutes: service.duration_minutes,
    addons: chosen,
    unknown: wanted.filter(k => !offered.has(k)),
  };
}

/** Normalised add-on keys as the server fingerprints them: unique and sorted. */
export const normaliseAddons = (keys: readonly string[]): string[] => [...new Set(keys)].sort();

