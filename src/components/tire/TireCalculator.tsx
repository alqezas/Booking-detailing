import {Banner} from '@astryxdesign/core/Banner';
import {HStack} from '@astryxdesign/core/HStack';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useTenant} from '../../app/tenant.tsx';
import {tireMsg} from '../../i18n/tire.ts';
import {formatDuration, formatMoney} from '../../lib/format.ts';
import type {PublicTenant, ServerQuote, Service} from '../../lib/types.ts';
import {
  DIAMETERS,
  MAX_WHEELS,
  RIMS,
  VEHICLES,
  operationFor,
  quote,
  type Rim,
  type TireOperation,
  type TireParams,
  type TireQuote,
  type Vehicle,
} from '../../../supabase/functions/_shared/tire.ts';

/** What the calculator chooses: an operation (a service) and the wheels. */
export type CalcValue = TireParams & {serviceId: string};

/** Services priced by the matrix, in the studio's order. */
export function tireServices(t: PublicTenant): {service: Service; op: TireOperation}[] {
  return t.services.flatMap(s => {
    const op = operationFor(t.tire, s.key);
    return op ? [{service: s, op}] : [];
  });
}

export const isTireService = (t: PublicTenant, s: Service | null | undefined): boolean => !!s && !!operationFor(t.tire, s.key);

const DRAFT_KEY = (slug: string) => `studio:${slug}:tire-calc`;

/** Last choice on this device (vehicle, rims, diameter): a repeat customer starts from it. */
export function initialCalc(t: PublicTenant, serviceId?: string | null): CalcValue {
  const first = tireServices(t)[0]?.service.id ?? '';
  const base: CalcValue = {serviceId: serviceId ?? first, vehicle: 'car', rim: 'alloy', diameter: 16, wheels: t.tire?.defaultWheels ?? 4};
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY(t.slug)) ?? '{}') as Partial<CalcValue>;
    return {
      ...base,
      vehicle: VEHICLES.includes(saved.vehicle as Vehicle) ? saved.vehicle! : base.vehicle,
      rim: RIMS.includes(saved.rim as Rim) ? saved.rim! : base.rim,
      diameter: DIAMETERS.includes(saved.diameter!) ? saved.diameter! : base.diameter,
    };
  } catch {
    return base;
  }
}

export function rememberCalc(slug: string, v: CalcValue): void {
  try {
    localStorage.setItem(DRAFT_KEY(slug), JSON.stringify({vehicle: v.vehicle, rim: v.rim, diameter: v.diameter}));
  } catch {
    /* private mode */
  }
}

export function calcQuote(t: PublicTenant, v: CalcValue): TireQuote | null {
  const service = t.services.find(s => s.id === v.serviceId);
  const op = service && operationFor(t.tire, service.key);
  return op ? quote(op, v, service.duration_minutes) : null;
}

/** «650 Kč za 4 kola» / «Cena na dotaz». */
export function quoteText(t: PublicTenant, q: Pick<TireQuote, 'price' | 'onRequest' | 'wheels'>, unit: 'set' | 'job'): string {
  const T = tireMsg();
  if (q.onRequest) return T.calc.onRequest;
  return `${formatMoney(q.price, t.currency)} ${unit === 'set' ? T.calc.forWheels(q.wheels) : T.calc.perJob}`;
}

export const fromServer = (q: ServerQuote): TireQuote => ({price: q.price, onRequest: q.on_request, durationMinutes: q.duration_minutes, wheels: q.wheels ?? 4});

/**
 * The price calculator: operation, vehicle, rims, diameter and number of
 * wheels → price and duration from the studio's matrix. The server repeats the
 * same calculation when the booking is made; `serverQuote`, when present, is
 * the price it returned and wins over the local one.
 */
export function TireCalculator({value, onChange, serverQuote, hideService}: {value: CalcValue; onChange: (v: CalcValue) => void; serverQuote?: ServerQuote | null; hideService?: boolean}) {
  const t = useTenant();
  const T = tireMsg();
  const ops = tireServices(t);
  const current = ops.find(o => o.service.id === value.serviceId) ?? ops[0];
  if (!current || !t.tire) return null;
  const local = quote(current.op, value, current.service.duration_minutes);
  const q = serverQuote ? fromServer(serverQuote) : local;
  const set = (patch: Partial<CalcValue>) => onChange({...value, ...patch});
  const names = t.tire.names;

  return (
    <VStack gap={3}>
      {!hideService && (
        <Selector
          label={T.calc.service}
          value={current.service.id}
          onChange={v => v && set({serviceId: v})}
          options={ops.map(o => ({value: o.service.id, label: o.service.name}))}
        />
      )}
      <SegmentedControl label={T.calc.vehicle} value={value.vehicle} onChange={v => set({vehicle: v as Vehicle})} layout="fill">
        {VEHICLES.map(v => (
          <SegmentedControlItem key={v} value={v} label={names.vehicles[v]} />
        ))}
      </SegmentedControl>
      <SegmentedControl label={T.calc.rim} value={value.rim} onChange={v => set({rim: v as Rim})} layout="fill">
        {RIMS.map(r => (
          <SegmentedControlItem key={r} value={r} label={names.rims[r]} />
        ))}
      </SegmentedControl>
      <HStack gap={2} align="end">
        <Selector
          label={T.calc.diameter}
          value={String(value.diameter)}
          onChange={v => v && set({diameter: Number(v)})}
          options={DIAMETERS.map(d => ({value: String(d), label: T.calc.diameterLabel(d)}))}
          width="100%"
        />
        {current.op.unit === 'set' && (
          <NumberInput label={T.calc.wheels} value={value.wheels} onChange={v => set({wheels: Math.min(MAX_WHEELS, Math.max(1, v ?? 4))})} min={1} max={MAX_WHEELS} step={1} width={120} />
        )}
      </HStack>
      <HStack justify="between" align="center" gap={2} role="status" aria-live="polite">
        <VStack gap={0}>
          <Text type="supporting">{T.calc.price}</Text>
          <Text type="large" weight="bold" hasTabularNumbers data-testid="tire-price">
            {quoteText(t, q, current.op.unit)}
          </Text>
        </VStack>
        <VStack gap={0} align="end">
          <Text type="supporting">{T.calc.duration}</Text>
          <Text weight="semibold" hasTabularNumbers>
            {formatDuration(q.durationMinutes)}
          </Text>
        </VStack>
      </HStack>
      {q.onRequest && <Banner status="info" title={T.calc.onRequest} description={T.calc.onRequestHint} collapsible={false} />}
    </VStack>
  );
}
