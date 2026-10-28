import {tireMsg} from '../../i18n/tire.ts';
import type {TireSource} from '../../../supabase/functions/_shared/tire.ts';

/** Plate and tyre rows of a booking's summary; empty for bookings without a plate. */
export function tireRows(b: {plate?: string | null; tire_size?: string | null; tire_source?: TireSource | null}): {label: string; value: string}[] {
  if (!b.plate) return [];
  const T = tireMsg();
  const tires = [b.tire_source ? T.details.sources[b.tire_source] : '', b.tire_size ?? ''].filter(Boolean).join(' · ');
  return [{label: T.summary.plate, value: b.plate}, ...(tires ? [{label: T.summary.tires, value: tires}] : [])];
}
