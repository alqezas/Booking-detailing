import {Banner} from '@astryxdesign/core/Banner';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useQuery} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';
import {PHONE_RE} from '../../../shared/business.ts';
import {tireMsg} from '../../i18n/tire.ts';
import {lookupTireStorage} from '../../lib/api/public.ts';
import {formatDate} from '../../lib/format.ts';
import {toE164} from '../../lib/schemas.ts';
import {PLATE_RE, TIRE_SOURCES, normalizePlate, type TireSource} from '../../../supabase/functions/_shared/tire.ts';

export type TireDetailsValue = {plate: string; tire_size: string; tire_source: TireSource};

const KEY = (slug: string) => `studio:${slug}:tire-details`;

/** Plate and tyre size typed last time on this device, for a repeat booking. */
export function loadTireDetails(slug: string): TireDetailsValue {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY(slug)) ?? '{}') as Partial<TireDetailsValue>;
    return {plate: saved.plate ?? '', tire_size: saved.tire_size ?? '', tire_source: 'own'};
  } catch {
    return {plate: '', tire_size: '', tire_source: 'own'};
  }
}

export function saveTireDetails(slug: string, v: TireDetailsValue): void {
  try {
    localStorage.setItem(KEY(slug), JSON.stringify({plate: v.plate, tire_size: v.tire_size}));
  } catch {
    /* private mode */
  }
}

/** Error text for the plate field, or null when it is valid. */
export const plateError = (plate: string): string | null => {
  const T = tireMsg();
  const p = normalizePlate(plate);
  if (!p) return T.details.plateRequired;
  return PLATE_RE.test(p) ? null : T.details.plateFormat;
};

/**
 * Plate, tyre size and whose tyres. With `storage` on, the customer is told
 * when the studio already keeps their set — looked up by phone AND plate, so
 * nobody learns anything about a set from a plate alone.
 */
export function TireDetails({
  slug,
  value,
  onChange,
  phone,
  storage,
  plateErrorText,
}: {
  slug: string;
  value: TireDetailsValue;
  onChange: (v: TireDetailsValue) => void;
  phone?: string;
  storage: boolean;
  plateErrorText?: string | null;
}) {
  const T = tireMsg();
  const plate = normalizePlate(value.plate);
  const e164 = phone ? toE164(phone) : '';
  const canLookup = storage && !!phone && PHONE_RE.test(e164) && PLATE_RE.test(plate);
  const stored = useQuery({
    queryKey: ['tire-storage', slug, e164, plate],
    queryFn: () => lookupTireStorage(slug, e164, plate),
    enabled: canLookup,
    staleTime: 60_000,
  });
  const hit = canLookup ? stored.data?.[0] : undefined;
  const touched = useRef(false);

  // The set is here: pre-select «from storage» unless the customer chose otherwise.
  useEffect(() => {
    if (hit && !touched.current && value.tire_source !== 'storage') onChange({...value, tire_source: 'storage'});
  }, [hit, value, onChange]);

  const sources = TIRE_SOURCES.filter(s => storage || s !== 'storage');
  return (
    <VStack gap={3}>
      <TextInput
        label={T.details.plate}
        value={value.plate}
        onChange={v => onChange({...value, plate: v.toUpperCase()})}
        placeholder={T.details.platePlaceholder}
        autoComplete="off"
        status={plateErrorText ? {type: 'error', message: plateErrorText} : undefined}
      />
      <TextInput
        label={T.details.tireSize}
        isOptional
        value={value.tire_size}
        onChange={v => onChange({...value, tire_size: v})}
        placeholder={T.details.tireSizePlaceholder}
        description={T.details.tireSizeHint}
      />
      <SegmentedControl
        label={T.details.source}
        value={value.tire_source}
        onChange={v => {
          touched.current = true;
          onChange({...value, tire_source: v as TireSource});
        }}
        layout="fill"
      >
        {sources.map(s => (
          <SegmentedControlItem key={s} value={s} label={T.details.sources[s]!} />
        ))}
      </SegmentedControl>
      {hit && (
        <Banner
          status="success"
          title={T.details.storedTitle}
          description={T.details.storedHint(T.seasons[hit.season] ?? hit.season, hit.tire_size, formatDate(hit.stored_at, {day: 'numeric', month: 'long', year: 'numeric'}))}
          collapsible={false}
        />
      )}
      {value.tire_source === 'buy' && <Text type="supporting">{T.details.buyHint}</Text>}
    </VStack>
  );
}
