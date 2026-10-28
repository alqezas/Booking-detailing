import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {TireCalculator, initialCalc, isTireService, type CalcValue} from '../../components/tire/TireCalculator.tsx';
import {plateError} from '../../components/tire/TireDetails.tsx';
import {msg} from '../../i18n/index.ts';
import {tireMsg} from '../../i18n/tire.ts';
import {randomKey} from '../../lib/booking-store.ts';
import {errorText} from '../../lib/errors.ts';
import {formatTime} from '../../lib/format.ts';
import {customerSchema, fieldErrors} from '../../lib/schemas.ts';
import {normalizePlate} from '../../../supabase/functions/_shared/tire.ts';
import {ownerKey, useOwner} from './ownerContext.tsx';

/**
 * Live queue: a customer who just drove in. The server puts the job into the
 * nearest slot from the current one on where a suitable post is free (working
 * hours apply, the online lead time does not) and returns the booking.
 */
export function WalkInSheet({isOpen, onClose, onCreated}: {isOpen: boolean; onClose: () => void; onCreated: (id: string) => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const qc = useQueryClient();
  const showToast = useToast();
  const T = tireMsg();
  const [calc, setCalc] = useState<CalcValue>(() => initialCalc(tenant));
  const [serviceId, setServiceId] = useState<string>(() => calc.serviceId || tenant.services[0]?.id || '');
  const [form, setForm] = useState({name: '', phone: '', car: '', plate: '', comment: ''});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(randomKey);
  const service = tenant.services.find(s => s.id === serviceId);
  const tire = isTireService(tenant, service);

  const create = useMutation({
    mutationFn: () => {
      const c = customerSchema.parse({...form, car: form.car.trim() || form.plate.trim()});
      return api.walkIn({
        serviceId,
        tire: tire ? {vehicle: calc.vehicle, rim: calc.rim, diameter: calc.diameter, wheels: calc.wheels, plate: normalizePlate(form.plate)} : null,
        name: c.name,
        phone: c.phone,
        car: c.car,
        comment: c.comment,
        key,
      });
    },
    onSuccess: b => {
      void qc.invalidateQueries({queryKey: ownerKey(slug)});
      void qc.invalidateQueries({queryKey: ['availability', slug]});
      showToast({body: T.walkIn.added(formatTime(b.start_at, tenant.timezone), b.resource_name)});
      setForm({name: '', phone: '', car: '', plate: '', comment: ''});
      setKey(randomKey());
      onClose();
      onCreated(b.id);
    },
    onError: () => setKey(randomKey()),
  });

  const submit = () => {
    const parsed = customerSchema.safeParse({...form, car: form.car.trim() || form.plate.trim()});
    const pErr = tire ? plateError(form.plate) : null;
    if (!parsed.success || pErr) {
      setErrors({...(parsed.success ? {} : fieldErrors(parsed.error)), ...(pErr ? {plate: pErr} : {})});
      return;
    }
    setErrors({});
    create.mutate();
  };
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({...f, [k]: k === 'plate' ? v.toUpperCase() : v}));
  const err = (k: string) => (errors[k] ? ({type: 'error', message: errors[k]} as const) : undefined);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={o => !o && onClose()} label={T.walkIn.title} height="tall" purpose="form">
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>{T.walkIn.title}</Heading>
          <Text color="secondary">{T.walkIn.lead}</Text>
        </VStack>
        <Selector
          label={msg.newBooking.service}
          value={serviceId}
          onChange={v => {
            if (!v) return;
            setServiceId(v);
            if (isTireService(tenant, tenant.services.find(s => s.id === v))) setCalc(c => ({...c, serviceId: v}));
          }}
          options={tenant.services.map(s => ({value: s.id, label: s.name}))}
        />
        {tire && <TireCalculator value={{...calc, serviceId}} onChange={setCalc} hideService />}
        <FormLayout defaultOptionality="required">
          {tire && <TextInput label={T.details.plate} value={form.plate} onChange={set('plate')} placeholder={T.details.platePlaceholder} status={err('plate')} />}
          <TextInput label={msg.newBooking.clientName} value={form.name} onChange={set('name')} status={err('name')} />
          <TextInput label={msg.flow.phone} value={form.phone} onChange={set('phone')} placeholder={msg.phonePlaceholder} status={err('phone')} />
          <TextInput label={msg.flow.car} isOptional={tire} value={form.car} onChange={set('car')} status={err('car')} />
        </FormLayout>
        {create.isError && <Banner status="error" title={errorText(create.error)} collapsible={false} />}
        <HStack gap={2}>
          <Button label={msg.common.close} variant="ghost" onClick={onClose} style={{flexShrink: 0}} />
          <Button label={T.walkIn.submit} variant="primary" width="100%" isLoading={create.isPending} onClick={submit} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}
