import {Dialog} from '@astryxdesign/core/Dialog';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {Phone} from '@phosphor-icons/react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {SlotPicker} from '../../components/booking/SlotPicker.tsx';
import {InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {randomKey} from '../../lib/booking-store.ts';
import {errorText} from '../../lib/errors.ts';
import {fmt, formatDuration, formatMoney, formatPhone, formatPrice, formatTime, formatWhen} from '../../lib/format.ts';
import {paymentSchema} from '../../lib/schemas.ts';
import type {BookingStatus, OwnerBooking} from '../../lib/types.ts';
import {statusLabel} from '../client/MyBookingPage.tsx';
import {ownerKey, useOwner} from './ownerContext.tsx';
import {msg} from '../../i18n/index.ts';
import {tireRows} from '../../components/tire/tireRows.ts';

type Mode = 'view' | 'pay' | 'move';

export function BookingSheet({bookingId, onClose}: {bookingId: string | null; onClose: () => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const qc = useQueryClient();
  const showToast = useToast();
  const [mode, setMode] = useState<Mode>('view');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const q = useQuery({
    queryKey: ownerKey(slug, 'booking', bookingId),
    queryFn: () => api.booking(bookingId!),
    enabled: !!bookingId,
  });

  const refresh = (b: OwnerBooking) => {
    qc.setQueryData(ownerKey(slug, 'booking', b.id), b);
    void qc.invalidateQueries({queryKey: ownerKey(slug, 'bookings')});
    void qc.invalidateQueries({queryKey: ownerKey(slug, 'stats')});
    void qc.invalidateQueries({queryKey: ownerKey(slug, 'availability')});
    void qc.invalidateQueries({queryKey: ['availability', slug]});
  };

  const status = useMutation({
    mutationFn: (s: BookingStatus) => api.setStatus(bookingId!, s),
    onSuccess: b => {
      refresh(b);
      showToast({body: msg.sheet.statusToast(statusLabel(b.status).label)});
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancel(bookingId!, reason),
    onSuccess: b => {
      refresh(b);
      setCancelOpen(false);
      showToast({body: msg.sheet.cancelledToast});
    },
  });

  const close = () => {
    setMode('view');
    onClose();
  };

  const b = q.data;
  const tz = tenant.timezone;

  return (
    <BottomSheet isOpen={!!bookingId} onOpenChange={o => !o && close()} label={msg.sheet.label} height="tall" purpose={mode === 'view' ? 'info' : 'form'}>
      {q.isPending ? (
        <RowsSkeleton rows={4} />
      ) : q.isError ? (
        <InlineError message={q.error.message} onRetry={() => void q.refetch()} />
      ) : b ? (
        mode === 'pay' ? (
          <PaymentForm booking={b} onDone={nb => {
            refresh(nb);
            setMode('view');
          }} onBack={() => setMode('view')} />
        ) : mode === 'move' ? (
          <MoveForm booking={b} onDone={nb => {
            refresh(nb);
            setMode('view');
          }} onBack={() => setMode('view')} />
        ) : (
          <VStack gap={4}>
            <VStack gap={1}>
              <HStack justify="between" align="center" gap={2}>
                <Heading level={2}>{b.service_name}</Heading>
                <Badge label={statusLabel(b.status).label} variant={statusLabel(b.status).variant} />
              </HStack>
              <Text color="secondary">
                {formatWhen(b.start_at, tz)}
                {b.duration_minutes >= 1440 ? msg.sheet.until(fmt(b.end_at, tz, msg.fmt.dayMonthTime)) : `–${formatTime(b.end_at, tz)}`} · {b.resource_name}
              </Text>
              {b.is_demo && <Text type="supporting">{msg.sheet.demo}</Text>}
            </VStack>

            <MetadataList>
              <MetadataListItem label={msg.summary.client}>
                <Text weight="semibold">{b.customer_name}</Text>
              </MetadataListItem>
              <MetadataListItem label={msg.summary.phone}>
                <Button label={msg.sheet.callTo(formatPhone(b.customer_phone))} variant="ghost" size="sm" icon={<Icon icon={Phone} />} href={`tel:${b.customer_phone}`}>
                  {formatPhone(b.customer_phone)}
                </Button>
              </MetadataListItem>
              <MetadataListItem label={msg.summary.car}>
                <Text>{b.car}</Text>
              </MetadataListItem>
              {tireRows(b).map(r => (
                <MetadataListItem key={r.label} label={r.label}>
                  <Text>{r.value}</Text>
                </MetadataListItem>
              ))}
              {b.comment && (
                <MetadataListItem label={msg.sheet.comment}>
                  <Text>{b.comment}</Text>
                </MetadataListItem>
              )}
              <MetadataListItem label={msg.summary.duration}>
                <Text>{formatDuration(b.duration_minutes)}</Text>
              </MetadataListItem>
              <MetadataListItem label={msg.summary.price}>
                <Text hasTabularNumbers>{formatPrice(b.price, b.price_from, tenant.currency)}</Text>
              </MetadataListItem>
              <MetadataListItem label={msg.sheet.paid}>
                <Text hasTabularNumbers>
                  {formatMoney(b.paid - b.refunded, tenant.currency)}
                  {b.refunded > 0 ? msg.sheet.refunded(formatMoney(b.refunded, tenant.currency)) : ''}
                </Text>
              </MetadataListItem>
              {b.status !== 'cancelled' && b.balance > 0 && (
                <MetadataListItem label={msg.sheet.toPay}>
                  <Text weight="semibold" hasTabularNumbers>
                    {formatMoney(b.balance, tenant.currency)}
                  </Text>
                </MetadataListItem>
              )}
              {b.status === 'cancelled' && (
                <MetadataListItem label={msg.sheet.cancellation}>
                  <Text>
                    {b.cancelled_by === 'client' ? msg.sheet.byClient : msg.sheet.byStudio}
                    {b.cancel_reason ? `: ${b.cancel_reason}` : ''}
                  </Text>
                </MetadataListItem>
              )}
            </MetadataList>

            {(status.isError || cancel.isError) && (
              <Banner status="error" title={errorText(status.error ?? cancel.error)} collapsible={false} />
            )}

            <VStack gap={2}>
              {b.status === 'confirmed' && (
                <>
                  <Button label={msg.sheet.arrived} variant="primary" width="100%" isLoading={status.isPending && status.variables === 'arrived'} onClick={() => status.mutate('arrived')} />
                  <HStack gap={2}>
                    <Button label={msg.sheet.readyNow} width="100%" isLoading={status.isPending && status.variables === 'ready'} onClick={() => status.mutate('ready')} />
                    <Button label={msg.sheet.noShow} width="100%" isLoading={status.isPending && status.variables === 'no_show'} onClick={() => status.mutate('no_show')} />
                  </HStack>
                </>
              )}
              {b.status === 'arrived' && (
                <>
                  <Button label={msg.sheet.carReady} variant="primary" width="100%" isLoading={status.isPending} onClick={() => status.mutate('ready')} />
                  <Button label={msg.sheet.backToWaiting} variant="ghost" onClick={() => status.mutate('confirmed')} />
                </>
              )}
              {b.status === 'ready' && <Button label={msg.sheet.backToWork} variant="ghost" onClick={() => status.mutate('arrived')} />}
              {b.status === 'no_show' && <Button label={msg.sheet.restore} onClick={() => status.mutate('confirmed')} />}
              <HStack gap={2} wrap="wrap">
                {b.status !== 'cancelled' && <Button label={msg.sheet.addPayment} onClick={() => setMode('pay')} />}
                {b.status === 'cancelled' && b.paid - b.refunded > 0 && <Button label={msg.sheet.refund} onClick={() => setMode('pay')} />}
                {(b.status === 'confirmed' || b.status === 'arrived') && <Button label={msg.sheet.move} onClick={() => setMode('move')} />}
                {(b.status === 'confirmed' || b.status === 'arrived' || b.status === 'no_show') && (
                  <Button label={msg.sheet.cancel} variant="destructive" onClick={() => setCancelOpen(true)} />
                )}
              </HStack>
            </VStack>

            {b.payments.length > 0 && (
              <>
                <Divider />
                <List header={<Heading level={3}>{msg.sheet.payments}</Heading>} hasDividers density="compact">
                  {b.payments.map(p => (
                    <ListItem
                      key={p.id}
                      label={`${p.kind === 'refund' ? '−' : '+'}${formatMoney(p.amount, tenant.currency)} · ${msg.methods.label[p.method]}`}
                      description={`${formatWhen(p.paid_at, tz)}${p.note ? ` · ${p.note}` : ''}`}
                    />
                  ))}
                </List>
              </>
            )}
            <Dialog isOpen={cancelOpen} onOpenChange={setCancelOpen} purpose="form" width={420}>
              <VStack gap={4} padding={4}>
                <Heading level={2}>{msg.sheet.cancelTitle}</Heading>
                <Text color="secondary">{msg.sheet.cancelText(b.customer_name, b.service_name, formatWhen(b.start_at, tz))}</Text>
                <TextInput label={msg.sheet.reason} isOptional value={reason} onChange={setReason} />
                <HStack gap={2} justify="end">
                  <Button label={msg.sheet.keep} variant="ghost" onClick={() => setCancelOpen(false)} />
                  <Button label={msg.sheet.cancel} variant="destructive" isLoading={cancel.isPending} onClick={() => cancel.mutate()} />
                </HStack>
              </VStack>
            </Dialog>
          </VStack>
        )
      ) : null}
    </BottomSheet>
  );
}

function PaymentForm({booking, onDone, onBack}: {booking: OwnerBooking; onDone: (b: OwnerBooking) => void; onBack: () => void}) {
  const tenant = useTenant();
  const {api} = useOwner();
  const net = booking.paid - booking.refunded;
  const [kind, setKind] = useState<'payment' | 'refund'>(booking.status === 'cancelled' ? 'refund' : 'payment');
  const [amount, setAmount] = useState<number | null>(kind === 'payment' ? Math.max(booking.balance, 0) || null : net || null);
  const [method, setMethod] = useState('card');
  const [note, setNote] = useState('');
  const [key] = useState(randomKey); // one key per form: a double tap records one payment
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const p = paymentSchema.parse({amount, method, note});
      return api.addPayment(booking.id, kind, p.amount, p.method, p.note, key);
    },
    onSuccess: onDone,
    onError: e => setError(e instanceof Error && 'issues' in e ? msg.sheet.checkAmount : errorText(e)),
  });
  return (
    <VStack gap={4}>
      <Heading level={2}>{kind === 'payment' ? msg.sheet.payment : msg.sheet.refundTitle}</Heading>
      <Text color="secondary">
        {msg.sheet.paySummary(
          booking.customer_name,
          booking.service_name,
          formatMoney(net, tenant.currency),
          booking.status !== 'cancelled' && booking.balance > 0 ? formatMoney(booking.balance, tenant.currency) : null,
        )}
      </Text>
      <SegmentedControl label={msg.sheet.opType} value={kind} onChange={v => setKind(v as 'payment' | 'refund')} layout="fill">
        {booking.status !== 'cancelled' && <SegmentedControlItem value="payment" label={msg.sheet.payment} />}
        <SegmentedControlItem value="refund" label={msg.sheet.refundTitle} isDisabled={net <= 0} />
      </SegmentedControl>
      <FormLayout>
        <NumberInput label={msg.sheet.amount} value={amount} onChange={setAmount} min={1} step={100} formatValue={v => formatMoney(v, tenant.currency)} />
        <Selector
          label={msg.sheet.method}
          value={method}
          onChange={v => v && setMethod(v)}
          options={Object.entries(msg.methods.label).map(([value, label]) => ({value, label}))}
        />
        <TextInput label={msg.sheet.comment} isOptional value={note} onChange={setNote} />
      </FormLayout>
      {error && <Banner status="error" title={error} collapsible={false} />}
      <HStack gap={2}>
        <Button label={msg.common.back} variant="ghost" onClick={onBack} style={{flexShrink: 0}} />
        <Button label={kind === 'payment' ? msg.sheet.recordPayment : msg.sheet.refund} variant="primary" width="100%" isLoading={save.isPending} onClick={() => save.mutate()} />
      </HStack>
    </VStack>
  );
}

function MoveForm({booking, onDone, onBack}: {booking: OwnerBooking; onDone: (b: OwnerBooking) => void; onBack: () => void}) {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const [start, setStart] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: () => api.reschedule(booking.id, start!),
    onSuccess: onDone,
    onError: e => {
      setNotice(errorText(e));
      setStart(null);
    },
  });
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2}>{msg.sheet.moveTitle}</Heading>
        <Text color="secondary">{msg.sheet.moveNow(formatWhen(booking.start_at, tenant.timezone))}</Text>
      </VStack>
      <SlotPicker
        slug={slug}
        serviceId={booking.service_id}
        timezone={tenant.timezone}
        horizonDays={tenant.booking.horizon_days}
        value={start}
        onChange={v => {
          setStart(v);
          setNotice(null);
        }}
        notice={notice}
        ownerLoad={(from, days) => api.availability(booking.service_id, from, days)}
      />
      <HStack gap={2}>
        <Button label={msg.common.back} variant="ghost" onClick={onBack} style={{flexShrink: 0}} />
        <Button
          label={start ? msg.sheet.moveTo(formatWhen(start, tenant.timezone)) : msg.sheet.pickTime}
          variant="primary"
          width="100%"
          isDisabled={!start}
          isLoading={move.isPending}
          onClick={() => move.mutate()}
        />
      </HStack>
    </VStack>
  );
}
