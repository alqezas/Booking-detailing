import {tireMsg} from '../../i18n/tire.ts';
import {washMsg} from '../../i18n/wash.ts';
import type {TireSource} from '../../../supabase/functions/_shared/tire.ts';

/** Plate and tyre rows of a booking's summary; empty for bookings without a plate. */
export function tireRows(b: {plate?: string | null; tire_size?: string | null; tire_source?: TireSource | null; pass?: {total: number; remaining: number} | null}): {label: string; value: string}[] {
  if (!b.plate) return [];
  const T = tireMsg();
  const pass = b.pass ? [{label: washMsg().passes.title, value: washMsg().passes.paidByPass(b.pass.remaining, b.pass.total)}] : [];
  const tires = [b.tire_source ? T.details.sources[b.tire_source] : '', b.tire_size ?? ''].filter(Boolean).join(' · ');
  return [{label: T.summary.plate, value: b.plate}, ...(tires ? [{label: T.summary.tires, value: tires}] : []), ...pass];
}
