/**
 * One face for the two calculators: tyre services (vehicle × rims × diameter)
 * and car washes (program × car class + extras). The booking flow, the owner
 * sheets and the home page work with a PricedValue and these helpers; the
 * server prices both through the same RPCs (private.priced_quote).
 */
import type {PublicTenant, ServerQuote, Service} from '../../lib/types.ts';
import {operationFor} from '../../../supabase/functions/_shared/tire.ts';
import {programFor} from '../../../supabase/functions/_shared/wash.ts';
import {TireCalculator, calcQuote, initialCalc, quoteText, rememberCalc, tireServices, type CalcValue} from '../tire/TireCalculator.tsx';
import {WashCalculator, initialWash, rememberWash, washPriceText, washQuoteOf, washServices, type WashValue} from '../wash/WashCalculator.tsx';

export type PricedValue = CalcValue | WashValue;
export type PricedQuote = {price: number; onRequest: boolean; durationMinutes: number; wheels?: number};

export const isWash = (v: PricedValue): v is WashValue => 'class' in v;

export const isPricedService = (t: PublicTenant, s: Service | null | undefined): boolean => !!s && (!!operationFor(t.tire, s.key) || !!programFor(t.wash, s.key));

export const pricedServices = (t: PublicTenant): Service[] => [...tireServices(t).map(x => x.service), ...washServices(t).map(x => x.service)];

/** Starting value for a service (or the studio's first calculator service); null without a calculator. */
export function initialPriced(t: PublicTenant, serviceId?: string | null): PricedValue | null {
  const s = serviceId ? t.services.find(x => x.id === serviceId) : undefined;
  if (s && programFor(t.wash, s.key)) return initialWash(t, s.id);
  if (s && operationFor(t.tire, s.key)) return initialCalc(t, s.id);
  if (tireServices(t).length) return initialCalc(t);
  if (washServices(t).length) return initialWash(t);
  return null;
}

export const rememberPriced = (slug: string, v: PricedValue) => (isWash(v) ? rememberWash(slug, v) : rememberCalc(slug, v));

export function pricedQuote(t: PublicTenant, v: PricedValue, server?: ServerQuote | null): PricedQuote | null {
  if (server) return {price: server.price, onRequest: server.on_request, durationMinutes: server.duration_minutes, wheels: server.wheels};
  return isWash(v) ? washQuoteOf(t, v) : calcQuote(t, v);
}

/** «750 Kč za 4 kola» for tyres, «1 560 Kč» for a wash, or «price on request». */
export function pricedText(t: PublicTenant, v: PricedValue, q: PricedQuote): string {
  if (isWash(v)) return washPriceText(t, q);
  const s = t.services.find(x => x.id === v.serviceId);
  const unit = (s && operationFor(t.tire, s.key)?.unit) ?? 'set';
  return quoteText(t, {price: q.price, onRequest: q.onRequest, wheels: q.wheels ?? v.wheels}, unit);
}

/** Parameters the server prices (no plate). */
export const pricedParams = (v: PricedValue): object =>
  isWash(v) ? {class: v.class, extras: v.extras} : {vehicle: v.vehicle, rim: v.rim, diameter: v.diameter, wheels: v.wheels};

/** Tyres always need the plate; a wash when the studio asks for it. */
export const plateMode = (t: PublicTenant, v: PricedValue): 'required' | 'optional' => (!isWash(v) || t.wash?.plateRequired ? 'required' : 'optional');

export function PricedCalculator({value, onChange, serverQuote, hideService}: {value: PricedValue; onChange: (v: PricedValue) => void; serverQuote?: ServerQuote | null; hideService?: boolean}) {
  return isWash(value) ? (
    <WashCalculator value={value} onChange={onChange} serverQuote={serverQuote} hideService={hideService} />
  ) : (
    <TireCalculator value={value} onChange={onChange} serverQuote={serverQuote} hideService={hideService} />
  );
}
