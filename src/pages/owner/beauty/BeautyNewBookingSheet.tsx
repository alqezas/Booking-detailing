import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {addonsQuote, normaliseAddons} from '../../../../supabase/functions/_shared/beauty.ts';
import {useTenant} from '../../../app/tenant.tsx';
import {mastersOf} from '../../../components/beauty/BeautyFlow.tsx';
import {SlotPicker} from '../../../components/booking/SlotPicker.tsx';
import {beautyMsg} from '../../../i18n/beauty.ts';
import {msg} from '../../../i18n/index.ts';
import {randomKey} from '../../../lib/booking-store.ts';
import {errorText, toApiError} from '../../../lib/errors.ts';
import {formatDuration, formatMoney, formatPrice} from '../../../lib/format.ts';
import {fieldErrors, personSchema} from '../../../lib/schemas.ts';
import {ownerKey, useOwner} from '../ownerContext.tsx';

const ANY = '__any__';

/**
 * A beauty booking taken by phone: service, options, master (or any free),
 * a free time — the same engine and conflict rules as online booking.
 */
export function BeautyNewBookingSheet({isOpen, onClose, onCreated}: {isOpen: boolean; onClose: () => void; onCreated: (id: string) => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const qc = useQueryClient();
  const showToast = useToast();
  const B = beautyMsg();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [addons, setAddons] = useState<string[]>([]);
  const [master, setMaster] = useState<string>(ANY);
  const [start, setStart] = useState<string | null>(null);
  const [form, setForm] = useState({name: '', phone: '', comment: ''});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState(randomKey);

  const service = tenant.services.find(s => s.id === serviceId) ?? null;
  const masters = mastersOf(tenant.resources).filter(m => !service?.resource_ids || service.resource_ids.includes(m.id));
  const quote = service ? addonsQuote(service, addons) : null;
  const resourceId = master === ANY ? null : master;

  const reset = () => {
    setServiceId(null);
    setAddons([]);
    setMaster(ANY);
    setStart(null);
    setForm({name: '', phone: '', comment: ''});
    setErrors({});
    setNotice(null);
    setKey(randomKey());
  };

  const create = useMutation({
    mutationFn: () => {
      const c = personSchema.parse(form);
      return api.createBeautyBooking({serviceId: serviceId!, startAt: start!, resourceId, name: c.name, phone: c.phone, comment: c.comment, addons: normaliseAddons(addons), key});
    },
    onSuccess: b => {
      void qc.invalidateQueries({queryKey: ownerKey(slug)});
      void qc.invalidateQueries({queryKey: ['availability', slug]});
      showToast({body: msg.newBooking.added});
      reset();
      onClose();
      onCreated(b.id);
    },
    onError: e => {
      if (toApiError(e).code === 'SLOT_TAKEN') {
        setStart(null);
        setNotice(errorText(e));
        setKey(randomKey());
      }
    },
  });

  const submit = () => {
    const parsed = personSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    create.mutate();
  };
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({...f, [k]: v}));

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={o => !o && onClose()} label={msg.newBooking.title} height="tall" purpose="form">
      <VStack gap={4}>
        <Heading level={2}>{msg.newBooking.title}</Heading>
        <Selector
          label={msg.newBooking.service}
          value={serviceId ?? undefined}
          onChange={v => {
            setServiceId(v ?? null);
            setAddons([]);
            setStart(null);
            setMaster(ANY);
          }}
          placeholder={msg.newBooking.pickService}
          options={tenant.services.map(s => ({
            value: s.id,
            label: s.name,
            description: `${formatPrice(s.price, s.price_from, tenant.currency)} · ${formatDuration(s.duration_minutes)}`,
          }))}
        />
        {service && !!service.addons?.length && (
          <CheckboxList label={B.owner.newBooking.options} value={addons} onChange={v => {
            setAddons(normaliseAddons(v));
            setStart(null);
          }}>
            {service.addons.map(a => (
              <CheckboxListItem key={a.key} value={a.key} label={a.name} description={B.flow.plus(formatDuration(a.duration_minutes), formatMoney(a.price, tenant.currency))} />
            ))}
          </CheckboxList>
        )}
        {service && masters.length > 1 && (
          <Selector
            label={B.owner.newBooking.master}
            value={master}
            onChange={v => {
              setMaster(v ?? ANY);
              setStart(null);
            }}
            options={[{value: ANY, label: B.flow.anyMaster}, ...masters.map(m => ({value: m.id, label: m.name, description: m.title}))]}
          />
        )}
        {quote && (
          <Text weight="semibold" hasTabularNumbers>
            {B.flow.total}: {formatDuration(quote.duration_minutes)} · {formatPrice(quote.price, quote.price_from, tenant.currency)}
          </Text>
        )}
        {service && (
          <SlotPicker
            slug={slug}
            serviceId={service.id}
            timezone={tenant.timezone}
            horizonDays={tenant.booking.horizon_days}
            value={start}
            onChange={v => {
              setStart(v);
              setNotice(null);
            }}
            notice={notice}
            load={(from, days) => api.beautyAvailability(service.id, normaliseAddons(addons), resourceId, from, days)}
            loadKey={['owner-beauty', normaliseAddons(addons).join(','), master]}
            dayParts={B.flow.dayParts}
          />
        )}
        {start && (
          <FormLayout defaultOptionality="required">
            <TextInput label={msg.newBooking.clientName} value={form.name} onChange={set('name')} status={errors.name ? {type: 'error', message: errors.name} : undefined} />
            <TextInput label={msg.flow.phone} value={form.phone} onChange={set('phone')} placeholder={msg.phonePlaceholder} status={errors.phone ? {type: 'error', message: errors.phone} : undefined} />
            <TextArea label={B.flow.commentLabel} isOptional value={form.comment} onChange={set('comment')} rows={2} />
          </FormLayout>
        )}
        {create.isError && toApiError(create.error).code !== 'SLOT_TAKEN' && <Banner status="error" title={errorText(create.error)} collapsible={false} />}
        <HStack gap={2}>
          <Button label={msg.common.close} variant="ghost" onClick={onClose} style={{flexShrink: 0}} />
          <Button label={msg.newBooking.create} variant="primary" width="100%" isDisabled={!start} isLoading={create.isPending} onClick={submit} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}
