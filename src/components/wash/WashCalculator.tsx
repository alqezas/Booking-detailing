import {Banner} from '@astryxdesign/core/Banner';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {HStack} from '@astryxdesign/core/HStack';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useTenant} from '../../app/tenant.tsx';
import {washMsg} from '../../i18n/wash.ts';
import {formatDuration, formatMoney} from '../../lib/format.ts';
import type {PublicTenant, ServerQuote, Service} from '../../lib/types.ts';
import {CAR_CLASSES, extrasFor, programFor, washQuote, type CarClass, type WashProgram, type WashQuote} from '../../../supabase/functions/_shared/wash.ts';

/** What the wash calculator chooses: a program (a service), the car class and extras. */
export type WashValue = {serviceId: string; class: CarClass; extras: string[]};

export function washServices(t: PublicTenant): {service: Service; program: WashProgram}[] {
  return t.services.flatMap(s => {
    const program = programFor(t.wash, s.key);
    return program ? [{service: s, program}] : [];
  });
}

const KEY = (slug: string) => `studio:${slug}:wash-calc`;

/** The last car class on this device: a repeat customer starts from it. */
export function initialWash(t: PublicTenant, serviceId?: string | null): WashValue {
  const first = washServices(t)[0]?.service.id ?? '';
  let cls: CarClass = 'medium';
  try {
    const saved = localStorage.getItem(KEY(t.slug)) as CarClass | null;
    if (saved && CAR_CLASSES.includes(saved)) cls = saved;
  } catch {
    /* private mode */
  }
  return {serviceId: serviceId ?? first, class: cls, extras: []};
}

export function rememberWash(slug: string, v: WashValue): void {
  try {
    localStorage.setItem(KEY(slug), v.class);
  } catch {
    /* private mode */
  }
}

export function washQuoteOf(t: PublicTenant, v: WashValue): WashQuote | null {
  const s = t.services.find(x => x.id === v.serviceId);
  const program = s && programFor(t.wash, s.key);
  return program && t.wash ? washQuote(t.wash, program, v, s.duration_minutes) : null;
}

export const washPriceText = (t: PublicTenant, q: Pick<WashQuote, 'price' | 'onRequest'>): string =>
  q.onRequest ? washMsg().calc.onRequest : formatMoney(q.price, t.currency);

/**
 * The wash calculator: program, car class and extras → price and time from
 * the studio's price list. The server repeats the calculation on booking;
 * `serverQuote`, when present, wins.
 */
export function WashCalculator({value, onChange, serverQuote, hideService}: {value: WashValue; onChange: (v: WashValue) => void; serverQuote?: ServerQuote | null; hideService?: boolean}) {
  const t = useTenant();
  const W = washMsg();
  const programs = washServices(t);
  const current = programs.find(p => p.service.id === value.serviceId) ?? programs[0];
  if (!current || !t.wash) return null;
  const extras = extrasFor(t.wash, current.service.key);
  const local = washQuote(t.wash, current.program, value, current.service.duration_minutes);
  const q = serverQuote ? {price: serverQuote.price, onRequest: serverQuote.on_request, durationMinutes: serverQuote.duration_minutes} : local;
  const set = (patch: Partial<WashValue>) => onChange({...value, ...patch});

  return (
    <VStack gap={3}>
      {!hideService && (
        <Selector
          label={W.calc.program}
          value={current.service.id}
          onChange={v => {
            if (!v) return;
            // Extras not offered with the new program are dropped.
            const next = programs.find(p => p.service.id === v)!;
            const allowed = new Set(extrasFor(t.wash!, next.service.key).map(e => e.key));
            set({serviceId: v, extras: value.extras.filter(e => allowed.has(e))});
          }}
          options={programs.map(p => ({value: p.service.id, label: p.service.name, description: p.service.description || undefined}))}
        />
      )}
      {/* Four classes do not fit a segmented control on a phone. */}
      <Selector label={W.calc.carClass} value={value.class} onChange={v => v && set({class: v as CarClass})} options={CAR_CLASSES.map(c => ({value: c, label: t.wash!.classes[c]}))} />
      {extras.length > 0 && (
        <CheckboxList label={W.calc.extras} value={value.extras} onChange={v => set({extras: v})} hasDividers>
          {extras.map(e => {
            const x = e.prices[value.class];
            return <CheckboxListItem key={e.key} value={e.key} label={e.name} description={!x || x.price === null ? W.calc.onRequest : `+ ${formatMoney(x.price, t.currency)}`} />;
          })}
        </CheckboxList>
      )}
      <HStack justify="between" align="center" gap={2} role="status" aria-live="polite">
        <VStack gap={0}>
          <Text type="supporting">{W.calc.price}</Text>
          <Text type="large" weight="bold" hasTabularNumbers data-testid="wash-price">
            {washPriceText(t, q)}
          </Text>
        </VStack>
        <VStack gap={0} align="end">
          <Text type="supporting">{W.calc.duration}</Text>
          <Text weight="semibold" hasTabularNumbers>
            {formatDuration(q.durationMinutes)}
          </Text>
        </VStack>
      </HStack>
      {q.onRequest && <Banner status="info" title={W.calc.onRequest} description={W.calc.onRequestHint} collapsible={false} />}
    </VStack>
  );
}
