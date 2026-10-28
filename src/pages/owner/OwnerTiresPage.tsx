import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {DateInput} from '@astryxdesign/core/DateInput';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Section} from '@astryxdesign/core/Section';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {ChatCircleText, Phone, Plus, WhatsappLogo} from '@phosphor-icons/react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {InlineEmpty, InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {msg} from '../../i18n/index.ts';
import {monthDay, tireMsg} from '../../i18n/tire.ts';
import {errorText} from '../../lib/errors.ts';
import {formatDate, formatPhone, formatWhen, todayIn} from '../../lib/format.ts';
import {customerSchema, fieldErrors} from '../../lib/schemas.ts';
import type {TireSet} from '../../lib/types.ts';
import {TIRE_SEASONS, normalizePlate, type TireSeason} from '../../../supabase/functions/_shared/tire.ts';
import {plateError} from '../../components/tire/TireDetails.tsx';
import {ownerKey, useOwner} from './ownerContext.tsx';

type Filter = 'stored' | 'due' | 'released';
type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;
const shortDate = (iso: string) => formatDate(iso.slice(0, 10), {day: 'numeric', month: 'numeric', year: 'numeric'});

/**
 * The tyre hotel: sets kept by the studio. Who is due for the coming season
 * (their set matches it and they have no booking) is listed first. Reminders
 * go out only through channels that really work here — a call, or an SMS /
 * WhatsApp sent from the owner's own phone with a prepared text.
 */
export default function OwnerTiresPage() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const T = tireMsg();
  const [filter, setFilter] = useState<Filter>('stored');
  const [editing, setEditing] = useState<TireSet | 'new' | null>(null);
  const q = useQuery({queryKey: ownerKey(slug, 'tire-sets', filter === 'released'), queryFn: () => api.tireSets(filter === 'released')});

  const sets = (q.data?.sets ?? []).filter(s => (filter === 'released' ? !!s.released_at : filter === 'due' ? s.due : !s.released_at));
  const season = q.data?.season;
  const empty = filter === 'due' ? T.owner.emptyDue : filter === 'released' ? T.owner.emptyReleased : T.owner.emptyStored;

  return (
    <VStack>
      <Section variant="transparent" padding={4} paddingInline={0}>
        <VStack gap={4}>
          <HStack justify="between" align="center" gap={2}>
            <VStack gap={1}>
              <Heading level={1}>{T.owner.title}</Heading>
              <Text color="secondary">{T.owner.lead}</Text>
            </VStack>
            <Button label={T.owner.add} variant="primary" icon={<Icon icon={Plus} />} onClick={() => setEditing('new')} />
          </HStack>
          <Banner
            status={season ? 'warning' : 'info'}
            title={season ? T.owner.seasonDue(T.mountTo[season.mount]!, monthDay(season.start.slice(5))) : T.owner.noSeason}
            description={T.owner.channelsNote}
            collapsible={false}
          />
          <SegmentedControl label={T.owner.title} value={filter} onChange={v => setFilter(v as Filter)} layout="fill">
            {(['stored', 'due', 'released'] as const).map(f => (
              <SegmentedControlItem key={f} value={f} label={T.owner.filters[f]!} />
            ))}
          </SegmentedControl>
        </VStack>
      </Section>
      <Section variant="transparent" padding={4} paddingInline={0} paddingBlockStart={0}>
        {q.isPending ? (
          <RowsSkeleton rows={4} height={64} />
        ) : q.isError ? (
          <InlineError message={q.error.message} onRetry={() => void q.refetch()} />
        ) : sets.length === 0 ? (
          <InlineEmpty title={empty} />
        ) : (
          <List hasDividers>
            {sets.map(s => (
              <ListItem
                key={s.id}
                label={`${s.plate} · ${s.customer_name}`}
                description={[
                  [T.seasons[s.season], s.tire_size, s.with_rims ? T.owner.withRims.toLowerCase() : ''].filter(Boolean).join(', '),
                  s.location,
                  s.tread_mm != null ? `${s.tread_mm} mm` : '',
                  s.next_booking_at ? T.owner.nextBooking(formatWhen(s.next_booking_at, tenant.timezone)) : '',
                  s.last_contacted_at ? T.owner.contactedAt(shortDate(s.last_contacted_at)) : '',
                  s.released_at ? T.owner.releasedAt(shortDate(s.released_at)) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                endContent={s.due ? <Badge label={T.owner.due} variant="warning" /> : undefined}
                onClick={() => setEditing(s)}
              />
            ))}
          </List>
        )}
      </Section>
      <TireSetSheet set={editing} mount={season?.mount ?? null} onClose={() => setEditing(null)} />
    </VStack>
  );
}

type Form = {
  customer_name: string;
  customer_phone: string;
  plate: string;
  car: string;
  tire_size: string;
  season: TireSeason;
  with_rims: boolean;
  tread_mm: number | null;
  condition: string;
  location: string;
  stored_at: string;
  note: string;
};

const toForm = (s: TireSet | null, today: string): Form => ({
  customer_name: s?.customer_name ?? '',
  customer_phone: s ? formatPhone(s.customer_phone) : '',
  plate: s?.plate ?? '',
  car: s?.car ?? '',
  tire_size: s?.tire_size ?? '',
  season: s?.season ?? 'winter',
  with_rims: s?.with_rims ?? false,
  tread_mm: s?.tread_mm ?? null,
  condition: s?.condition ?? '',
  location: s?.location ?? '',
  stored_at: s?.stored_at ?? today,
  note: s?.note ?? '',
});

function TireSetSheet({set, mount, onClose}: {set: TireSet | 'new' | null; mount: 'summer' | 'winter' | null; onClose: () => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const qc = useQueryClient();
  const showToast = useToast();
  const T = tireMsg();
  const existing = set && set !== 'new' ? set : null;
  const today = todayIn(tenant.timezone);
  const [form, setForm] = useState<Form>(() => toForm(existing, today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<TireSet | 'new' | null>(null);
  // Reset the form whenever another set is opened.
  if (set !== openedFor) {
    setOpenedFor(set);
    setForm(toForm(existing, today));
    setErrors({});
  }
  const f = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm(x => ({...x, [k]: v}));

  const done = (text: string) => {
    void qc.invalidateQueries({queryKey: ownerKey(slug, 'tire-sets')});
    showToast({body: text});
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const c = customerSchema.pick({name: true, phone: true}).safeParse({name: form.customer_name, phone: form.customer_phone});
      const pErr = plateError(form.plate);
      if (!c.success || pErr) {
        setErrors({...(c.success ? {} : fieldErrors(c.error)), ...(pErr ? {plate: pErr} : {})});
        throw new Error('invalid');
      }
      setErrors({});
      return api.saveTireSet(existing?.id ?? null, {
        customer_name: c.data.name,
        customer_phone: c.data.phone,
        plate: normalizePlate(form.plate),
        car: form.car.trim(),
        tire_size: form.tire_size.trim(),
        season: form.season,
        with_rims: form.with_rims,
        tread_mm: form.tread_mm,
        condition: form.condition.trim(),
        location: form.location.trim(),
        stored_at: form.stored_at,
        note: form.note.trim(),
      });
    },
    onSuccess: () => done(T.owner.saved),
  });
  const patch = useMutation({
    mutationFn: (p: Partial<TireSet>) => api.saveTireSet(existing!.id, p),
    onSuccess: (_d, p) => done(p.released_at ? T.owner.released : T.owner.saved),
  });

  const phoneDigits = existing?.customer_phone.replace(/\D/g, '') ?? '';
  const text = existing ? T.owner.smsText(tenant.name, existing.plate, T.mountTo[mount ?? (existing.season === 'summer' ? 'summer' : 'winter')]!) : '';

  return (
    <BottomSheet isOpen={!!set} onOpenChange={o => !o && onClose()} label={existing ? T.owner.sheetEdit : T.owner.sheetNew} height="tall" purpose="form">
      <VStack gap={4}>
        <Heading level={2}>{existing ? `${existing.plate} · ${existing.customer_name}` : T.owner.sheetNew}</Heading>
        {existing && !existing.released_at && (
          <VStack gap={2}>
            <HStack gap={2} wrap="wrap">
              <Button label={T.owner.call} icon={<Icon icon={Phone} />} href={`tel:${existing.customer_phone}`} />
              <Button label={T.owner.sms} icon={<Icon icon={ChatCircleText} />} href={`sms:${existing.customer_phone}?&body=${encodeURIComponent(text)}`} />
              <Button label={T.owner.whatsapp} icon={<Icon icon={WhatsappLogo} />} href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`} target="_blank" />
            </HStack>
            <HStack gap={2} wrap="wrap">
              <Button label={T.owner.markContacted} variant="secondary" isLoading={patch.isPending} onClick={() => patch.mutate({last_contacted_at: new Date().toISOString()})} />
              <Button label={T.owner.release} variant="ghost" isLoading={patch.isPending} onClick={() => patch.mutate({released_at: today})} />
            </HStack>
          </VStack>
        )}
        <FormLayout>
          <TextInput label={T.owner.customer} value={form.customer_name} onChange={f('customer_name')} status={errors.name ? {type: 'error', message: errors.name} : undefined} />
          <TextInput label={msg.flow.phone} value={form.customer_phone} onChange={f('customer_phone')} placeholder={msg.phonePlaceholder} status={errors.phone ? {type: 'error', message: errors.phone} : undefined} />
          <TextInput label={T.details.plate} value={form.plate} onChange={v => f('plate')(v.toUpperCase())} placeholder={T.details.platePlaceholder} status={errors.plate ? {type: 'error', message: errors.plate} : undefined} />
          <TextInput label={T.owner.car} isOptional value={form.car} onChange={f('car')} />
          <TextInput label={T.details.tireSize} isOptional value={form.tire_size} onChange={f('tire_size')} placeholder={T.details.tireSizePlaceholder} />
          <SegmentedControl label={T.owner.season} value={form.season} onChange={v => f('season')(v as TireSeason)} layout="fill">
            {TIRE_SEASONS.map(s => (
              <SegmentedControlItem key={s} value={s} label={T.seasons[s]!} />
            ))}
          </SegmentedControl>
          <Switch label={T.owner.withRims} value={form.with_rims} onChange={f('with_rims')} />
          <NumberInput label={T.owner.tread} isOptional value={form.tread_mm} onChange={v => f('tread_mm')(v)} min={0} max={20} step={0.5} hasClear />
          <TextInput label={T.owner.condition} isOptional value={form.condition} onChange={f('condition')} placeholder={T.owner.conditionPlaceholder} />
          <TextInput label={T.owner.location} isOptional value={form.location} onChange={f('location')} placeholder={T.owner.locationPlaceholder} />
          <DateInput label={T.owner.storedAt} value={form.stored_at as ISODate} onChange={v => v && f('stored_at')(v)} max={today as ISODate} />
          <TextInput label={T.owner.note} isOptional value={form.note} onChange={f('note')} />
        </FormLayout>
        {(save.isError && (save.error as Error).message !== 'invalid') || patch.isError ? (
          <Banner status="error" title={errorText(save.error ?? patch.error)} collapsible={false} />
        ) : null}
        <HStack gap={2}>
          <Button label={msg.common.close} variant="ghost" onClick={onClose} style={{flexShrink: 0}} />
          <Button label={T.owner.save} variant="primary" width="100%" isLoading={save.isPending} onClick={() => save.mutate()} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}
