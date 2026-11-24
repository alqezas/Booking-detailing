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
import {createBooking, createTireBooking, getTireAvailability} from '../../lib/api/public.ts';
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
import {tireMsg} from '../../i18n/tire.ts';
import type {ServerQuote} from '../../lib/types.ts';
import {normalizePlate} from '../../../supabase/functions/_shared/tire.ts';
import {TireDetails, loadTireDetails, plateError, saveTireDetails, type TireDetailsValue} from '../tire/TireDetails.tsx';
import {WashDetails} from '../wash/WashDetails.tsx';
import {washMsg} from '../../i18n/wash.ts';
import {
  PricedCalculator,
  initialPriced,
  isPricedService,
  isWash,
  plateMode,
  pricedParams,
  pricedQuote,
  pricedServices,
  pricedText,
  rememberPriced,
  type PricedValue,
} from '../priced/priced.tsx';

type Step = 'service' | 'time' | 'details' | 'confirm' | 'done';

/** open(): the service sheet; open(id): straight to time; open(id, calc): a calculator service priced on the home page. */
export type FlowApi = {open: (serviceId?: string, calc?: PricedValue) => void};
export const FlowContext = createContext<FlowApi | null>(null);

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
  // Calculator services (tyres, wash): the choice, the server's quote and plate/tyre details.
  const [calc, setCalc] = useState<PricedValue | null>(null);
  const [serverQuote, setServerQuote] = useState<ServerQuote | null>(null);
  const [tire, setTire] = useState<TireDetailsValue>(() => loadTireDetails(tenant.slug));
  const tireMode = isPricedService(tenant, service) && !!calc;
  const washMode = tireMode && isWash(calc!);
  const T = tireMsg();

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
    (serviceId?: string, preset?: PricedValue) => {
      const s = serviceId ? (tenant.services.find(x => x.id === serviceId) ?? null) : null;
      const tireStart = preset ?? initialPriced(tenant, s && isPricedService(tenant, s) ? s.id : null);
      setService(s ?? (tireStart ? (tenant.services.find(x => x.id === tireStart.serviceId) ?? null) : null));
      setCalc(tireStart);
      setServerQuote(null);
      setStartAt(null);
      setNotice(null);
      setErrors({});
      setResult(null);
      // A calculator service starts at the calculator unless the home page already priced it.
      setStep(!s ? 'service' : isPricedService(tenant, s) && !preset ? 'service' : 'time');
    },
    [tenant],
  );

  const onCalc = useCallback(
    (v: PricedValue) => {
      setCalc(v);
      setServerQuote(null);
      setStartAt(null);
      setService(tenant.services.find(x => x.id === v.serviceId) ?? null);
    },
    [tenant.services],
  );
  const onLoaded = useCallback((a: {quote?: ServerQuote}) => setServerQuote(a.quote ?? null), []);

  const create = useMutation({
    mutationFn: async () => {
      const parsed = customerSchema.parse(customer);
      if (tireMode) {
        const t = isWash(calc!)
          ? {class: calc.class, extras: calc.extras, plate: normalizePlate(tire.plate)}
          : {...calc!, serviceId: undefined, plate: normalizePlate(tire.plate), tire_size: tire.tire_size.trim(), tire_source: tire.tire_source};
        return createTireBooking({
          slug: tenant.slug,
          serviceId: service!.id,
          startAt: startAt!,
          name: parsed.name,
          phone: parsed.phone,
          car: parsed.car,
          comment: parsed.comment,
          idempotencyKey: attemptKey(tenant.slug, `${service!.id}|${startAt}|${parsed.phone}|${JSON.stringify(t)}`),
          tire: t,
        });
      }
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
    const plateErr = tireMode && (plateMode(tenant, calc!) === 'required' || tire.plate.trim()) ? plateError(tire.plate) : null;
    if (!parsed.success || plateErr) {
      setErrors({...(parsed.success ? {} : fieldErrors(parsed.error)), ...(plateErr ? {plate: plateErr} : {})});
      return;
    }
    setErrors({});
    if (tireMode) {
      saveTireDetails(tenant.slug, tire);
      rememberPriced(tenant.slug, calc!);
    }
    try {
      localStorage.setItem(DRAFT_KEY(tenant.slug), JSON.stringify({name: parsed.data.name, phone: customer.phone, car: parsed.data.car}));
    } catch {
      /* private mode */
    }
    setStep('confirm');
  };

  // With a tyre matrix the priced operations live in the calculator; the list shows the rest.
  const grouped = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of tenant.services) if (!isPricedService(tenant, s)) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [tenant]);
  const hasCalc = pricedServices(tenant).length > 0;
  const tireQuote = tireMode ? pricedQuote(tenant, calc!, serverQuote) : null;
  const shownName = tireMode && serverQuote ? serverQuote.label : (service?.name ?? '');
  const shownPrice = tireQuote ? tireQuote.price : (service?.price ?? 0);
  const shownFrom = tireQuote ? false : (service?.price_from ?? false);
  const shownDuration = tireQuote ? tireQuote.durationMinutes : (service?.duration_minutes ?? 0);
  const tireRows = washMode
    ? tire.plate.trim()
      ? [{label: T.summary.plate, value: normalizePlate(tire.plate)}]
      : undefined
    : tireMode
    ? [
        {label: T.summary.plate, value: normalizePlate(tire.plate)},
        {label: T.summary.tires, value: [T.details.sources[tire.tire_source], tire.tire_size.trim()].filter(Boolean).join(' · ')},
      ]
    : undefined;

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
              <Text color="secondary">{hasCalc ? (tenant.wash ? washMsg().calc.lead : T.calc.lead) : msg.flow.step1}</Text>
            </VStack>
            {hasCalc && calc && (
              <VStack gap={3}>
                <PricedCalculator value={calc} onChange={onCalc} />
                <Button
                  label={T.calc.choose}
                  variant="primary"
                  width="100%"
                  onClick={() => {
                    setService(tenant.services.find(x => x.id === calc.serviceId) ?? null);
                    setStep('time');
                  }}
                />
              </VStack>
            )}
            {hasCalc && grouped.length > 0 && <Heading level={3}>{T.calc.otherServices}</Heading>}
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
                      setCalc(null);
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
                <Heading level={2}>{shownName}</Heading>
                <Text color="secondary">
                  {msg.flow.step2(
                    formatDuration(shownDuration),
                    tireQuote ? pricedText(tenant, calc!, tireQuote) : formatPrice(service.price, service.price_from, tenant.currency),
                  )}
                </Text>
              </VStack>
              <SlotPicker
                slug={tenant.slug}
                serviceId={service.id}
                timezone={tz}
                horizonDays={tenant.booking.effective_horizon_days ?? tenant.booking.horizon_days}
                {...(tireMode
                  ? {
                      load: (from: string, days: number) =>
                        getTireAvailability(tenant.slug, service.id, pricedParams(calc!), from, days),
                      loadKey: ['priced', JSON.stringify(pricedParams(calc!))],
                      onLoaded,
                    }
                  : {})}
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
            {washMode && (
              <WashDetails
                slug={tenant.slug}
                plate={tire.plate}
                onPlate={v => setTire(x => ({...x, plate: v}))}
                phone={customer.phone}
                required={plateMode(tenant, calc!) === 'required'}
                errorText={errors.plate}
              />
            )}
            {tireMode && !washMode && (
              <VStack gap={2}>
                <TireDetails slug={tenant.slug} value={tire} onChange={setTire} phone={customer.phone} storage={!!tenant.tire?.storage} plateErrorText={errors.plate} />
                <Text type="supporting">{T.details.remembered}</Text>
              </VStack>
            )}
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
                serviceName={shownName}
                price={shownPrice}
                priceFrom={shownFrom}
                durationMinutes={shownDuration}
                startAt={startAt}
                timezone={tz}
                currency={tenant.currency}
                customer={{name: customer.name, phone: customerSchema.shape.phone.safeParse(customer.phone).data ?? customer.phone, car: customer.car}}
                extra={tireRows}
              />
              {tireMode && !washMode && <Text type="supporting">{T.summary.labourOnly}</Text>}
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
                extra={result.booking.plate ? [{label: T.summary.plate, value: result.booking.plate}] : undefined}
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
