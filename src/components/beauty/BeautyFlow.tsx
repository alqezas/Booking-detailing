import {Avatar} from '@astryxdesign/core/Avatar';
import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet, BottomSheetSwitcher} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {CheckCircle, UsersThree} from '@phosphor-icons/react';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {useNavigate} from 'react-router';
import {addonsQuote, normaliseAddons} from '../../../supabase/functions/_shared/beauty.ts';
import {useTenant} from '../../app/tenant.tsx';
import {beautyMsg} from '../../i18n/beauty.ts';
import {msg} from '../../i18n/index.ts';
import {createBeautyBooking, getBeautyAvailability} from '../../lib/api/public.ts';
import {attemptKey, clearAttempt, rememberBooking} from '../../lib/booking-store.ts';
import {ApiError, toApiError} from '../../lib/errors.ts';
import {formatDuration, formatMoney, formatPrice, formatWhen} from '../../lib/format.ts';
import {mediaUrl} from '../../lib/media.ts';
import {bookingKey} from '../../lib/queries.ts';
import {fieldErrors, personSchema} from '../../lib/schemas.ts';
import {isAddonsParams, type PublicBooking, type Resource, type ServerQuote, type Service} from '../../lib/types.ts';
import {BookingSummary} from '../booking/BookingSummary.tsx';
import {FlowContext} from '../booking/BookingFlow.tsx';
import {ReminderOffer} from '../booking/ReminderOffer.tsx';
import {SlotPicker} from '../booking/SlotPicker.tsx';

type Step = 'options' | 'time' | 'details' | 'done';
export type Selection = {serviceId: string; addons: string[]};

type BeautyApi = {
  selection: Selection | null;
  service: Service | null;
  /** Live preview of the total; the server quote replaces it once slots load. */
  total: {price: number; minutes: number; priceFrom: boolean} | null;
  master: string | null;
  masters: Resource[];
  /** Choose a service (opens its options when it has any). */
  select: (serviceId: string) => void;
  clear: () => void;
  setMaster: (id: string | null) => void;
  openOptions: () => void;
  openTime: () => void;
};
const BeautyContext = createContext<BeautyApi | null>(null);

export function useBeauty(): BeautyApi {
  const c = useContext(BeautyContext);
  if (!c) throw new Error('useBeauty outside BeautyFlowProvider');
  return c;
}

/** Masters (role «master») of the studio; places like chairs are never offered as a choice. */
export const mastersOf = (resources: Resource[] | undefined) => (resources ?? []).filter(r => r.role === 'master');

const DRAFT_KEY = (slug: string) => `studio:${slug}:customer`;
const SELECTION_KEY = (slug: string) => `studio:${slug}:selection`;
type Draft = {name: string; phone: string; comment: string};

function loadDraft(slug: string): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY(slug)) ?? '{}');
    return {name: d.name ?? '', phone: d.phone ?? '', comment: ''};
  } catch {
    return {name: '', phone: '', comment: ''};
  }
}
function loadSelection(slug: string): {sel: Selection | null; master: string | null} {
  try {
    const s = JSON.parse(sessionStorage.getItem(SELECTION_KEY(slug)) ?? 'null');
    return s && typeof s.serviceId === 'string' ? {sel: {serviceId: s.serviceId, addons: Array.isArray(s.addons) ? s.addons : []}, master: s.master ?? null} : {sel: null, master: null};
  } catch {
    return {sel: null, master: null};
  }
}

/**
 * Beauty booking in three steps on one sequential bottom sheet:
 *   1. the service and its options (total time and price add up live);
 *   2. the master (or «any free master»), the date and a time grouped into
 *      morning / day / evening — taken times stay visible and crossed out;
 *   3. name, phone, a wish for the visit, the summary and «Confirm».
 * The selection survives a reload (session storage) and is shown in the
 * bottom bar. The server prices the booking itself; the browser only previews.
 */
export function BeautyFlowProvider({children}: {children: ReactNode}) {
  const tenant = useTenant();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const B = beautyMsg();
  const initial = useMemo(() => loadSelection(tenant.slug), [tenant.slug]);
  const [selection, setSelection] = useState<Selection | null>(initial.sel);
  const [master, setMasterState] = useState<string | null>(initial.master);
  const [step, setStep] = useState<Step | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quote, setQuote] = useState<ServerQuote | null>(null);
  const [customer, setCustomer] = useState<Draft>(() => loadDraft(tenant.slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{booking: PublicBooking; token: string} | null>(null);
  const pushedHistory = useRef(false);

  const service = useMemo(() => tenant.services.find(s => s.id === selection?.serviceId) ?? null, [tenant.services, selection]);
  const allMasters = useMemo(() => mastersOf(tenant.resources), [tenant.resources]);
  const serviceMasters = useMemo(
    () => (service ? allMasters.filter(m => !service.resource_ids || service.resource_ids.includes(m.id)) : allMasters),
    [service, allMasters],
  );
  // A master who does not do this service falls back to «any free master».
  const effectiveMaster = master && serviceMasters.some(m => m.id === master) ? master : null;
  const preview = service && selection ? addonsQuote(service, selection.addons) : null;
  const total = preview ? {price: quote?.price ?? preview.price, minutes: quote?.duration_minutes ?? preview.duration_minutes, priceFrom: preview.price_from} : null;

  useEffect(() => {
    try {
      if (selection) sessionStorage.setItem(SELECTION_KEY(tenant.slug), JSON.stringify({...selection, master}));
      else sessionStorage.removeItem(SELECTION_KEY(tenant.slug));
    } catch {
      /* private mode */
    }
  }, [selection, master, tenant.slug]);

  // A service removed by the owner since the last visit: drop the stale selection.
  useEffect(() => {
    if (selection && !service) setSelection(null);
  }, [selection, service]);

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

  // Astryx TextInput has no type="tel": ask phones for the numeric keypad directly.
  useEffect(() => {
    if (step !== 'details') return;
    const id = requestAnimationFrame(() =>
      document.querySelectorAll<HTMLInputElement>('[data-beauty-details] input[autocomplete="tel"]').forEach(i => i.setAttribute('inputmode', 'tel')),
    );
    return () => cancelAnimationFrame(id);
  }, [step]);

  const resetTime = () => {
    setStartAt(null);
    setQuote(null);
    setNotice(null);
  };

  const select = useCallback(
    (serviceId: string) => {
      const s = tenant.services.find(x => x.id === serviceId);
      if (!s) return;
      setSelection(prev => (prev?.serviceId === serviceId ? prev : {serviceId, addons: []}));
      setStartAt(null);
      setQuote(null);
      setNotice(null);
      setResult(null);
      if (s.addons?.length) setStep('options');
    },
    [tenant.services],
  );

  const api: BeautyApi = useMemo(
    () => ({
      selection,
      service,
      total,
      master: effectiveMaster,
      masters: allMasters,
      select,
      clear: () => {
        setSelection(null);
        setStep(null);
      },
      setMaster: id => {
        setMasterState(id);
        setStartAt(null);
      },
      openOptions: () => service && setStep('options'),
      openTime: () => {
        if (!service) return;
        setResult(null);
        setStep('time');
      },
    }),
    [selection, service, total, effectiveMaster, allMasters, select],
  );

  // Generic entry used by shared pages («Записаться» on the services page, ?book=1).
  const flowApi = useMemo(
    () => ({
      open: (serviceId?: string) => {
        if (serviceId) return select(serviceId);
        if (service) return setStep('time');
        document.getElementById('booking-title')?.scrollIntoView({behavior: 'smooth', block: 'start'});
      },
    }),
    [select, service],
  );

  const create = useMutation({
    mutationFn: async () => {
      const parsed = personSchema.parse(customer);
      const addons = normaliseAddons(selection!.addons);
      return createBeautyBooking({
        slug: tenant.slug,
        serviceId: service!.id,
        startAt: startAt!,
        resourceId: effectiveMaster,
        name: parsed.name,
        phone: parsed.phone,
        comment: parsed.comment,
        addons,
        // The same attempt keeps the same key: a double tap or a retry never makes a second booking.
        idempotencyKey: attemptKey(tenant.slug, `${service!.id}|${startAt}|${parsed.phone}|${addons.join(',')}|${effectiveMaster ?? 'any'}`),
      });
    },
    onSuccess: r => {
      clearAttempt(tenant.slug);
      rememberBooking(tenant.slug, {id: r.booking.id, token: r.access_token, startAt: r.booking.start_at, serviceName: r.booking.service_name});
      qc.setQueryData(bookingKey(tenant.slug, r.access_token), r.booking);
      void qc.invalidateQueries({queryKey: ['availability', tenant.slug]});
      setResult({booking: r.booking, token: r.access_token});
      setSelection(null);
      setStep('done');
    },
    onError: e => {
      const err = toApiError(e);
      if (['SLOT_TAKEN', 'NOT_A_SLOT', 'OUTSIDE_BOOKING_WINDOW', 'ADDON_NOT_FOUND'].includes(err.code)) {
        void qc.invalidateQueries({queryKey: ['availability', tenant.slug]});
        void qc.invalidateQueries({queryKey: ['tenant', tenant.slug]});
        setStartAt(null);
        setNotice(err.message);
        setStep(err.code === 'ADDON_NOT_FOUND' ? 'options' : 'time');
      }
    },
  });

  const submit = () => {
    const parsed = personSchema.safeParse(customer);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      // Focus the first invalid field for keyboard and screen-reader users.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-beauty-details] [aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    try {
      localStorage.setItem(DRAFT_KEY(tenant.slug), JSON.stringify({name: parsed.data.name, phone: customer.phone}));
    } catch {
      /* private mode */
    }
    if (!create.isPending) create.mutate();
  };

  const tz = tenant.timezone;
  const money = (n: number) => formatMoney(n, tenant.currency);
  const set = (k: keyof Draft) => (v: string) => setCustomer(c => ({...c, [k]: v}));
  const masterName = (id: string | null) => allMasters.find(m => m.id === id)?.name;
  const chosenAddons = preview?.addons ?? [];
  const summaryExtra = [
    ...(chosenAddons.length ? [{label: B.flow.options, value: chosenAddons.map(a => a.name).join(', ')}] : []),
    ...(serviceMasters.length > 1 || effectiveMaster ? [{label: B.flow.master2, value: masterName(effectiveMaster) ?? B.flow.anyMaster}] : []),
  ];

  return (
    <FlowContext.Provider value={flowApi}>
      <BeautyContext.Provider value={api}>
        {children}
        <BottomSheetSwitcher
          activeSheet={step}
          onActiveSheetChange={s => {
            if (s === null) close();
            else setStep(s as Step);
          }}
        >
          <BottomSheet sheetId="options" label={B.flow.optionsSheet} height="tall">
            {service && selection && preview && (
              <VStack gap={4}>
                <VStack gap={1}>
                  <Text type="supporting">{B.flow.step(1)}</Text>
                  <Heading level={2}>{service.name}</Heading>
                  {service.description && <Text color="secondary">{service.description}</Text>}
                </VStack>
                {notice && step === 'options' && <Banner status="warning" title={notice} collapsible={false} />}
                {service.addons?.length ? (
                  <CheckboxList label={B.flow.optionsTitle} description={B.flow.optionsLead} value={selection.addons} onChange={v => {
                    setSelection(s => (s ? {...s, addons: normaliseAddons(v)} : s));
                    resetTime();
                  }} hasDividers>
                    {service.addons.map(a => (
                      <CheckboxListItem
                        key={a.key}
                        value={a.key}
                        label={a.name}
                        description={a.duration_minutes ? B.flow.plus(formatDuration(a.duration_minutes), money(a.price)) : B.flow.plusPrice(money(a.price))}
                      />
                    ))}
                  </CheckboxList>
                ) : (
                  <Text color="secondary">{B.flow.noOptions}</Text>
                )}
                <HStack justify="between" align="center" gap={2}>
                  <Text weight="semibold">{B.flow.total}</Text>
                  <Text weight="bold" type="large" hasTabularNumbers aria-live="polite">
                    {formatDuration(preview.duration_minutes)} · {formatPrice(preview.price, preview.price_from, tenant.currency)}
                  </Text>
                </HStack>
                <Button label={B.bar.chooseTime} variant="primary" size="lg" width="100%" onClick={() => setStep('time')} />
              </VStack>
            )}
          </BottomSheet>

          <BottomSheet sheetId="time" label={B.flow.timeSheet} height="tall">
            {service && selection && total && (
              <VStack gap={4}>
                <VStack gap={1}>
                  <Text type="supporting">{B.flow.step(2)}</Text>
                  <Heading level={2}>{service.name}</Heading>
                  <Text color="secondary" hasTabularNumbers>
                    {[...chosenAddons.map(a => a.name)].join(' · ') || service.category}
                    {' — '}
                    {formatDuration(total.minutes)} · {formatPrice(total.price, total.priceFrom, tenant.currency)}
                  </Text>
                </VStack>
                {serviceMasters.length > 1 && (
                  <VStack gap={2}>
                    <Heading level={3}>{B.flow.master}</Heading>
                    <HStack gap={2} isScrollable role="radiogroup" aria-label={B.flow.masterAria} style={{paddingBlockEnd: 'var(--spacing-1)'}}>
                      <MasterChoice
                        label={B.flow.anyMaster}
                        hint={B.flow.anyMasterHint}
                        selected={effectiveMaster === null}
                        onSelect={() => {
                          setMasterState(null);
                          resetTime();
                        }}
                      />
                      {serviceMasters.map(m => (
                        <MasterChoice
                          key={m.id}
                          label={m.name}
                          hint={m.title}
                          photo={mediaUrl(m.photo_path)}
                          selected={effectiveMaster === m.id}
                          onSelect={() => {
                            setMasterState(m.id);
                            resetTime();
                          }}
                        />
                      ))}
                    </HStack>
                  </VStack>
                )}
                <SlotPicker
                  // A new master or option set starts over at the first day with free time.
                  key={`${normaliseAddons(selection.addons).join(',')}|${effectiveMaster ?? 'any'}`}
                  slug={tenant.slug}
                  serviceId={service.id}
                  timezone={tz}
                  horizonDays={tenant.booking.horizon_days}
                  load={(from, days) => getBeautyAvailability(tenant.slug, service.id, normaliseAddons(selection.addons), effectiveMaster, from, days)}
                  loadKey={['beauty', normaliseAddons(selection.addons).join(','), effectiveMaster ?? 'any']}
                  onLoaded={a => setQuote(a.quote ?? null)}
                  value={startAt}
                  onChange={v => {
                    setStartAt(v);
                    setNotice(null);
                  }}
                  notice={notice}
                  dayParts={B.flow.dayParts}
                />
                <HStack gap={2}>
                  <Button label={msg.common.back} variant="ghost" onClick={() => setStep('options')} style={{flexShrink: 0}} />
                  <Button label={msg.common.next} variant="primary" width="100%" isDisabled={!startAt} onClick={() => setStep('details')} />
                </HStack>
              </VStack>
            )}
          </BottomSheet>

          <BottomSheet sheetId="details" label={B.flow.detailsSheet} height="tall" purpose="form">
            {service && startAt && total && (
              <VStack gap={4} data-beauty-details>
                <VStack gap={1}>
                  <Text type="supporting">{B.flow.step(3)}</Text>
                  <Heading level={2}>{msg.flow.confirmTitle}</Heading>
                </VStack>
                <BookingSummary
                  serviceName={service.name}
                  price={total.price}
                  priceFrom={total.priceFrom}
                  durationMinutes={total.minutes}
                  startAt={startAt}
                  timezone={tz}
                  currency={tenant.currency}
                  extra={summaryExtra}
                />
                <FormLayout defaultOptionality="required">
                  <TextInput
                    label={msg.flow.name}
                    value={customer.name}
                    onChange={set('name')}
                    autoComplete="name"
                    status={errors.name ? {type: 'error', message: errors.name} : undefined}
                  />
                  <TextInput
                    label={msg.flow.phone}
                    value={customer.phone}
                    onChange={set('phone')}
                    autoComplete="tel"
                    placeholder={msg.phonePlaceholder}
                    description={msg.flow.phoneHint}
                    status={errors.phone ? {type: 'error', message: errors.phone} : undefined}
                  />
                  <TextArea
                    label={B.flow.commentLabel}
                    isOptional
                    value={customer.comment}
                    onChange={set('comment')}
                    rows={2}
                    maxLength={500}
                    placeholder={B.flow.commentPlaceholder}
                    status={errors.comment ? {type: 'error', message: errors.comment} : undefined}
                  />
                </FormLayout>
                <Text type="supporting">{msg.flow.cancelRule(tenant.booking.cancel_cutoff_hours)}</Text>
                {create.isError && !(create.error instanceof ApiError && ['SLOT_TAKEN', 'NOT_A_SLOT'].includes(create.error.code)) && (
                  <Banner status="error" title={msg.flow.notCreated} description={toApiError(create.error).message} collapsible={false} />
                )}
                <HStack gap={2}>
                  <Button label={msg.common.back} variant="ghost" isDisabled={create.isPending} onClick={() => setStep('time')} style={{flexShrink: 0}} />
                  <Button label={B.flow.confirm} variant="primary" size="lg" width="100%" isLoading={create.isPending} onClick={submit} />
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
                  extra={[
                    ...(isAddonsParams(result.booking.tire_params) && result.booking.tire_params.addons.length
                      ? [{label: B.flow.options, value: result.booking.tire_params.addons.map(a => a.name).join(', ')}]
                      : []),
                    ...(result.booking.resource_role === 'master' ? [{label: B.flow.master2, value: result.booking.resource_name}] : []),
                  ]}
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
      </BeautyContext.Provider>
    </FlowContext.Provider>
  );
}

/** One radio choice in the master row: photo (or a group icon for «any»), name and specialisation. */
function MasterChoice({label, hint, photo, selected, onSelect}: {label: string; hint?: string; photo?: string | null; selected: boolean; onSelect: () => void}) {
  return (
    <Button
      label={label}
      role="radio"
      aria-checked={selected}
      variant={selected ? 'primary' : 'secondary'}
      onClick={onSelect}
      style={{flexShrink: 0, minHeight: 64, paddingInline: 'var(--spacing-3)'}}
    >
      <HStack gap={2} align="center">
        {photo !== undefined ? (
          <Avatar src={photo ?? undefined} name={label} size="md" tooltip={false} />
        ) : (
          <Icon icon={UsersThree} size="md" color="inherit" />
        )}
        <VStack gap={0} align="start">
          <Text weight="semibold" color="inherit" maxLines={1}>
            {label}
          </Text>
          {hint && (
            <Text type="supporting" color="inherit" maxLines={1}>
              {hint}
            </Text>
          )}
        </VStack>
      </HStack>
    </Button>
  );
}
