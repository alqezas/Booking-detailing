import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useQuery} from '@tanstack/react-query';
import {PHONE_RE} from '../../../shared/business.ts';
import {washMsg} from '../../i18n/wash.ts';
import {lookupWashPass} from '../../lib/api/public.ts';
import {toE164} from '../../lib/schemas.ts';
import {PLATE_RE, normalizePlate} from '../../../supabase/functions/_shared/tire.ts';

/**
 * The plate of a wash booking (required when the studio says so) and, when
 * the customer has a pass, how many washes are left — looked up by phone AND
 * plate only.
 */
export function WashDetails({slug, plate, onPlate, phone, required, errorText}: {slug: string; plate: string; onPlate: (v: string) => void; phone?: string; required: boolean; errorText?: string | null}) {
  const W = washMsg();
  const p = normalizePlate(plate);
  const e164 = phone ? toE164(phone) : '';
  const can = !!phone && PHONE_RE.test(e164) && PLATE_RE.test(p);
  const pass = useQuery({queryKey: ['wash-pass', slug, e164, p], queryFn: () => lookupWashPass(slug, e164, p), enabled: can, staleTime: 60_000});
  const hit = can ? pass.data?.[0] : undefined;
  return (
    <VStack gap={2}>
      <TextInput
        label={W.details.plate}
        isOptional={!required}
        value={plate}
        onChange={v => onPlate(v.toUpperCase())}
        description={W.details.plateHint}
        autoComplete="off"
        status={errorText ? {type: 'error', message: errorText} : undefined}
      />
      {hit && <Banner status="success" title={W.details.passTitle} description={W.details.passHint(hit.remaining, hit.total)} collapsible={false} />}
    </VStack>
  );
}
