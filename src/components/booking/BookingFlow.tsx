import {BottomSheet, BottomSheetSwitcher} from '@astryxdesign/core/BottomSheet';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {CaretRight, CheckCircle} from '@phosphor-icons/react';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {useNavigate} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {createBooking} from '../../lib/api/public.ts';
import {attemptKey, clearAttempt, rememberBooking} from '../../lib/booking-store.ts';
import {ApiError, toApiError} from '../../lib/errors.ts';
import {formatDuration, formatPrice, formatWhen} from '../../lib/format.ts';
import {bookingKey} from '../../lib/queries.ts';
import {customerSchema, fieldErrors, type CustomerInput} from '../../lib/schemas.ts';
import type {PublicBooking, Service} from '../../lib/types.ts';
import {BookingSummary} from './BookingSummary.tsx';
import {ReminderOffer} from './ReminderOffer.tsx';
import {SlotPicker} from './SlotPicker.tsx';
import {msg} from '../../i18n/index.ts';

type Step = 'service' | 'time' | 'details' | 'confirm' | 'done';

type FlowApi = {open: (serviceId?: string) => void};
const FlowContext = createContext<FlowApi | null>(null);

export function useBookingFlow(): FlowApi {
  const c = useContext(FlowContext);
  if (!c) throw new Error('useBookingFlow outside BookingFlowProvider');
  return c;
}

const DRAFT_KEY = (slug: string) => `studio:${slug}:customer`;
const loadDraft = (slug: string): CustomerInput => {
  try {
    return {name: '', phone: '', car: '', comment: '', ...JSON.parse(localStorage.getItem(DRAFT_KEY(slug)) ?? '{}')};
  } catch {
    return {name: '', phone: '', car: '', comment: ''};
  }
};

export function BookingFlowProvider({children}: {children: ReactNode}) {
  const tenant = useTenant();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerInput>(() => loadDraft(tenant.slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{booking: PublicBooking; token: string} | null>(null);
  const pushedHistory = useRef(false);

  const close = useCallback(() => {
    setStep(null);
    if (pushedHistory.current) {
      pushedHistory.current = false;
      history.back();
    }
  }, []);

  // Android/desktop Back closes the sheet instead of leaving the page.
  useEffect(() => {
    if (!step) return;
    if (!pushedHistory.current) {
      history.pushState({...history.state, bookingSheet: true}, '');
      pushedHistory.current = true;
    }
    const onPop = () => {
      pushedHistory.current = false;
      setStep(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [step]);

  const open = useCallback(
    (serviceId?: string) => {
      const s = serviceId ? tenant.services.find(x => x.id === serviceId) ?? null : null;
      setService(s);
      setStartAt(null);
      setNotice(null);
      setErrors({});
      setResult(null);
      setStep(s ? 'time' : 'service');
    },
    [tenant.services],
  );

  const create = useMutation({
    mutationFn: async () => {
      const parsed = customerSchema.parse(customer);
      const fingerprint = `${service!.id}|${startAt}|${parsed.phone}`;
      return createBooking({
        slug: tenant.slug,
        serviceId: service!.id,
        startAt: startAt!,
        name: parsed.name,
        phone: parsed.phone,
        car: parsed.car,
        comment: parsed.comment,
        idempotencyKey: attemptKey(tenant.slug, fingerprint),
      });
    },
    onSuccess: r => {
      clearAttempt(tenant.slug);
      rememberBooking(tenant.slug, {id: r.booking.id, token: r.access_token, startAt: r.booking.start_at, serviceName: r.booking.service_name});
      qc.setQueryData(bookingKey(tenant.slug, r.access_token), r.booking);
      void qc.invalidateQueries({queryKey: ['availability', tenant.slug]});
      setResult({booking: r.booking, token: r.access_token});
      setStep('done');
    },
    onError: e => {
      const err = toApiError(e);
      if (err.code === 'SLOT_TAKEN' || err.code === 'NOT_A_SLOT' || err.code === 'OUTSIDE_BOOKING_WINDOW') {
        void qc.invalidateQueries({queryKey: ['availability', tenant.slug]});
        setStartAt(null);
        setNotice(err.message);
        setStep('time');
      }
    },
  });

  const submitDetails = () => {
    const parsed = customerSchema.safeParse(customer);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      localStorage.setItem(DRAFT_KEY(tenant.slug), JSON.stringify({name: parsed.data.name, phone: customer.phone, car: parsed.data.car}));
    } catch {
      /* private mode */
    }
    setStep('confirm');
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of tenant.services) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [tenant.services]);

  const set = (k: keyof CustomerInput) => (v: string) => setCustomer(c => ({...c, [k]: v}));
  const tz = tenant.timezone;
  const api = useMemo(() => ({open}), [open]);

  return (
    <FlowContext.Provider value={api}>
      {children}
      <BottomSheetSwitcher
        activeSheet={step}
        onActiveSheetChange={s => {
          if (s === null) close();
          else setStep(s as Step);
        }}
      >
        <BottomSheet sheetId="service" label={msg.flow.serviceSheet} height="tall">
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={2}>{msg.flow.title}</Heading>
              <Text color="secondary">{msg.flow.step1}</Text>
            </VStack>
            {grouped.map(([category, services]) => (
              <List key={category} header={<Heading level={3}>{category}</Heading>} hasDividers>
                {services.map(s => (
                  <ListItem
                    key={s.id}
                    label={s.name}
                    description={`${formatPrice(s.price, s.price_from, tenant.currency)} · ${formatDuration(s.duration_minutes)}`}
                    endContent={<Icon icon={CaretRight} color="secondary" />}
                    onClick={() => {
                      setService(s);
                      setStartAt(null);
                      setNotice(null);
                      setStep('time');
                    }}
                  />
                ))}
              </List>
            ))}
          </VStack>
        </BottomSheet>

        <BottomSheet sheetId="time" label={msg.flow.timeSheet} height="tall">
          {service && (
            <VStack gap={4}>
              <VStack gap={1}>
                <Heading level={2}>{service.name}</Heading>
                <Text color="secondary">
                  {msg.flow.step2(formatDuration(service.duration_minutes), formatPrice(service.price, service.price_from, tenant.currency))}
                </Text>
              </VStack>
              <SlotPicker
                slug={tenant.slug}
                serviceId={service.id}
                timezone={tz}
                horizonDays={tenant.booking.horizon_days}
                value={startAt}
                onChange={v => {
                  setStartAt(v);
                  setNotice(null);
                }}
                notice={notice}
              />
              <HStack gap={2}>
                <Button label={msg.common.back} variant="ghost" onClick={() => setStep('service')} style={{flexShrink: 0}} />
                <Button label={msg.common.next} variant="primary" width="100%" isDisabled={!startAt} onClick={() => setStep('details')} />
              </HStack>
            </VStack>
          )}
        </BottomSheet>

        <BottomSheet sheetId="details" label={msg.flow.detailsSheet} height="tall" purpose="form">
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={2}>{msg.flow.yourData}</Heading>
              <Text color="secondary">{msg.flow.step3}</Text>
            </VStack>
            <FormLayout defaultOptionality="required">
              <TextInput label={msg.flow.name} value={customer.name} onChange={set('name')} autoComplete="name" status={errors.name ? {type: 'error', message: errors.name} : undefined} />
              <TextInput
                label={msg.flow.phone}
                value={customer.phone}
                onChange={set('phone')}
                autoComplete="tel"
                placeholder={msg.phonePlaceholder}
                description={msg.flow.phoneHint}
                status={errors.phone ? {type: 'error', message: errors.phone} : undefined}
              />
              <TextInput label={msg.flow.car} value={customer.car} onChange={set('car')} placeholder={msg.flow.carPlaceholder} status={errors.car ? {type: 'error', message: errors.car} : undefined} />
              <TextArea label={msg.flow.comment} isOptional value={customer.comment ?? ''} onChange={set('comment')} rows={2} maxLength={500} />
            </FormLayout>
            <HStack gap={2}>
              <Button label={msg.common.back} variant="ghost" onClick={() => setStep('time')} style={{flexShrink: 0}} />
              <Button label={msg.flow.review} variant="primary" width="100%" onClick={submitDetails} />
            </HStack>
          </VStack>
        </BottomSheet>

        <BottomSheet sheetId="confirm" label={msg.flow.confirmSheet} height="tall" purpose="form">
          {service && startAt && (
            <VStack gap={4}>
              <Heading level={2}>{msg.flow.confirmTitle}</Heading>
              <BookingSummary
                serviceName={service.name}
                price={service.price}
                priceFrom={service.price_from}
                durationMinutes={service.duration_minutes}
                startAt={startAt}
                timezone={tz}
                currency={tenant.currency}
                customer={{name: customer.name, phone: customerSchema.shape.phone.safeParse(customer.phone).data ?? customer.phone, car: customer.car}}
              />
              <Text type="supporting">{msg.flow.cancelRule(tenant.booking.cancel_cutoff_hours)}</Text>
              {create.isError && !(create.error instanceof ApiError && create.error.code === 'SLOT_TAKEN') && (
                <Banner status="error" title={msg.flow.notCreated} description={toApiError(create.error).message} collapsible={false} />
              )}
              <HStack gap={2}>
                <Button label={msg.flow.edit} variant="ghost" isDisabled={create.isPending} onClick={() => setStep('details')} style={{flexShrink: 0}} />
                <Button
                  label={msg.flow.confirm}
                  variant="primary"
                  size="lg"
                  width="100%"
                  isLoading={create.isPending}
                  onClick={() => {
                    if (!create.isPending) create.mutate();
                  }}
                />
              </HStack>
            </VStack>
          )}
        </BottomSheet>

        <BottomSheet sheetId="done" label={msg.flow.doneSheet} height="tall">
          {result && (
            <VStack gap={4}>
              <HStack gap={2} align="center">
                <Icon icon={CheckCircle} color="success" size="lg" />
                <Heading level={2}>{msg.flow.doneTitle}</Heading>
              </HStack>
              <Text>{msg.flow.doneText(result.booking.service_name, formatWhen(result.booking.start_at, tz), tenant.address)}</Text>
              <BookingSummary
                serviceName={result.booking.service_name}
                price={result.booking.price}
                priceFrom={result.booking.price_from}
                durationMinutes={result.booking.duration_minutes}
                startAt={result.booking.start_at}
                endAt={result.booking.end_at}
                timezone={tz}
                currency={tenant.currency}
              />
              <ReminderOffer booking={result.booking} token={result.token} />
              <HStack gap={2}>
                <Button
                  label={msg.flow.myBooking}
                  variant="primary"
                  width="100%"
                  onClick={() => {
                    setStep(null);
                    pushedHistory.current = false;
                    navigate(`/s/${tenant.slug}/my?b=${result.booking.id}`, {replace: true});
                  }}
                />
                <Button label={msg.common.done} variant="ghost" onClick={close} style={{flexShrink: 0}} />
              </HStack>
            </VStack>
          )}
        </BottomSheet>
      </BottomSheetSwitcher>
    </FlowContext.Provider>
  );
}
