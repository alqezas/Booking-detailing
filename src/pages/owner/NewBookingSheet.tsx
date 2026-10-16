import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Selector} from '@astryxdesign/core/Selector';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {SlotPicker} from '../../components/booking/SlotPicker.tsx';
import {randomKey} from '../../lib/booking-store.ts';
import {errorText, toApiError} from '../../lib/errors.ts';
import {formatDuration, formatPrice} from '../../lib/format.ts';
import {customerSchema, fieldErrors} from '../../lib/schemas.ts';
import {ownerKey, useOwner} from './ownerContext.tsx';

/** A booking taken by phone: same engine, same conflict rules as online booking. */
export function NewBookingSheet({isOpen, onClose, onCreated}: {isOpen: boolean; onClose: () => void; onCreated: (id: string) => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const qc = useQueryClient();
  const showToast = useToast();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [form, setForm] = useState({name: '', phone: '', car: '', comment: ''});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState(randomKey);

  const reset = () => {
    setServiceId(null);
    setStart(null);
    setForm({name: '', phone: '', car: '', comment: ''});
    setErrors({});
    setNotice(null);
    setKey(randomKey());
  };

  const create = useMutation({
    mutationFn: () => {
      const c = customerSchema.parse(form);
      return api.createBooking({serviceId: serviceId!, startAt: start!, name: c.name, phone: c.phone, car: c.car, comment: c.comment, key});
    },
    onSuccess: b => {
      void qc.invalidateQueries({queryKey: ownerKey(slug)});
      void qc.invalidateQueries({queryKey: ['availability', slug]});
      showToast({body: 'Запись добавлена'});
      reset();
      onClose();
      onCreated(b.id);
    },
    onError: e => {
      const err = toApiError(e);
      if (err.code === 'SLOT_TAKEN') {
        setStart(null);
        setNotice(err.message);
        setKey(randomKey());
      }
    },
  });

  const submit = () => {
    const parsed = customerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    create.mutate();
  };

  const service = tenant.services.find(s => s.id === serviceId);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({...f, [k]: v}));

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={o => !o && onClose()} label="Новая запись" height="tall" purpose="form">
      <VStack gap={4}>
        <Heading level={2}>Новая запись</Heading>
        <Selector
          label="Услуга"
          value={serviceId ?? undefined}
          onChange={v => {
            setServiceId(v ?? null);
            setStart(null);
          }}
          placeholder="Выберите услугу"
          options={tenant.services.map(s => ({
            value: s.id,
            label: s.name,
            description: `${formatPrice(s.price, s.price_from, tenant.currency)} · ${formatDuration(s.duration_minutes)}`,
          }))}
        />
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
            ownerLoad={(from, days) => api.availability(service.id, from, days)}
          />
        )}
        {start && (
          <FormLayout defaultOptionality="required">
            <TextInput label="Имя клиента" value={form.name} onChange={set('name')} status={errors.name ? {type: 'error', message: errors.name} : undefined} />
            <TextInput label="Телефон" value={form.phone} onChange={set('phone')} placeholder="+7 999 123-45-67" status={errors.phone ? {type: 'error', message: errors.phone} : undefined} />
            <TextInput label="Автомобиль" value={form.car} onChange={set('car')} status={errors.car ? {type: 'error', message: errors.car} : undefined} />
            <TextArea label="Комментарий" isOptional value={form.comment} onChange={set('comment')} rows={2} />
          </FormLayout>
        )}
        {create.isError && toApiError(create.error).code !== 'SLOT_TAKEN' && (
          <Banner status="error" title={errorText(create.error)} collapsible={false} />
        )}
        <HStack gap={2}>
          <Button label="Закрыть" variant="ghost" onClick={onClose} style={{flexShrink: 0}} />
          <Button label="Создать запись" variant="primary" width="100%" isDisabled={!start} isLoading={create.isPending} onClick={submit} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}
