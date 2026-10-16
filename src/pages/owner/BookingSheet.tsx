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
import {STATUS_LABEL} from '../client/MyBookingPage.tsx';
import {ownerKey, useOwner} from './ownerContext.tsx';

const METHOD_LABEL: Record<string, string> = {cash: 'Наличные', card: 'Карта', transfer: 'Перевод', other: 'Другое'};

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
      showToast({body: `Статус: ${STATUS_LABEL[b.status].label}`});
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancel(bookingId!, reason),
    onSuccess: b => {
      refresh(b);
      setCancelOpen(false);
      showToast({body: 'Запись отменена, время освобождено'});
    },
  });

  const close = () => {
    setMode('view');
    onClose();
  };

  const b = q.data;
  const tz = tenant.timezone;

  return (
    <BottomSheet isOpen={!!bookingId} onOpenChange={o => !o && close()} label="Запись" height="tall" purpose={mode === 'view' ? 'info' : 'form'}>
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
                <Badge label={STATUS_LABEL[b.status].label} variant={STATUS_LABEL[b.status].variant} />
              </HStack>
              <Text color="secondary">
                {formatWhen(b.start_at, tz)}
                {b.duration_minutes >= 1440 ? ` — до ${fmt(b.end_at, tz, 'd MMMM, HH:mm')}` : `–${formatTime(b.end_at, tz)}`} · {b.resource_name}
              </Text>
              {b.is_demo && <Text type="supporting">Демонстрационная запись</Text>}
            </VStack>

            <MetadataList>
              <MetadataListItem label="Клиент">
                <Text weight="semibold">{b.customer_name}</Text>
              </MetadataListItem>
              <MetadataListItem label="Телефон">
                <Button label={`Позвонить ${formatPhone(b.customer_phone)}`} variant="ghost" size="sm" icon={<Icon icon={Phone} />} href={`tel:${b.customer_phone}`}>
                  {formatPhone(b.customer_phone)}
                </Button>
              </MetadataListItem>
              <MetadataListItem label="Автомобиль">
                <Text>{b.car}</Text>
              </MetadataListItem>
              {b.comment && (
                <MetadataListItem label="Комментарий">
                  <Text>{b.comment}</Text>
                </MetadataListItem>
              )}
              <MetadataListItem label="Длительность">
                <Text>{formatDuration(b.duration_minutes)}</Text>
              </MetadataListItem>
              <MetadataListItem label="Стоимость">
                <Text hasTabularNumbers>{formatPrice(b.price, b.price_from, tenant.currency)}</Text>
              </MetadataListItem>
              <MetadataListItem label="Оплачено">
                <Text hasTabularNumbers>
                  {formatMoney(b.paid - b.refunded, tenant.currency)}
                  {b.refunded > 0 ? ` (возвращено ${formatMoney(b.refunded, tenant.currency)})` : ''}
                </Text>
              </MetadataListItem>
              {b.status !== 'cancelled' && b.balance > 0 && (
                <MetadataListItem label="К оплате">
                  <Text weight="semibold" hasTabularNumbers>
                    {formatMoney(b.balance, tenant.currency)}
                  </Text>
                </MetadataListItem>
              )}
              {b.status === 'cancelled' && (
                <MetadataListItem label="Отмена">
                  <Text>
                    {b.cancelled_by === 'client' ? 'Клиентом' : 'Студией'}
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
                  <Button label="Машина принята" variant="primary" width="100%" isLoading={status.isPending && status.variables === 'arrived'} onClick={() => status.mutate('arrived')} />
                  <HStack gap={2}>
                    <Button label="Сразу готово" width="100%" isLoading={status.isPending && status.variables === 'ready'} onClick={() => status.mutate('ready')} />
                    <Button label="Не приехал" width="100%" isLoading={status.isPending && status.variables === 'no_show'} onClick={() => status.mutate('no_show')} />
                  </HStack>
                </>
              )}
              {b.status === 'arrived' && (
                <>
                  <Button label="Машина готова" variant="primary" width="100%" isLoading={status.isPending} onClick={() => status.mutate('ready')} />
                  <Button label="Вернуть в «Ожидаем»" variant="ghost" onClick={() => status.mutate('confirmed')} />
                </>
              )}
              {b.status === 'ready' && <Button label="Вернуть в работу" variant="ghost" onClick={() => status.mutate('arrived')} />}
              {b.status === 'no_show' && <Button label="Восстановить запись" onClick={() => status.mutate('confirmed')} />}
              <HStack gap={2} wrap="wrap">
                {b.status !== 'cancelled' && <Button label="Внести оплату" onClick={() => setMode('pay')} />}
                {b.status === 'cancelled' && b.paid - b.refunded > 0 && <Button label="Оформить возврат" onClick={() => setMode('pay')} />}
                {(b.status === 'confirmed' || b.status === 'arrived') && <Button label="Перенести" onClick={() => setMode('move')} />}
                {(b.status === 'confirmed' || b.status === 'arrived' || b.status === 'no_show') && (
                  <Button label="Отменить запись" variant="destructive" onClick={() => setCancelOpen(true)} />
                )}
              </HStack>
            </VStack>

            {b.payments.length > 0 && (
              <>
                <Divider />
                <List header={<Heading level={3}>Платежи</Heading>} hasDividers density="compact">
                  {b.payments.map(p => (
                    <ListItem
                      key={p.id}
                      label={`${p.kind === 'refund' ? '−' : '+'}${formatMoney(p.amount, tenant.currency)} · ${METHOD_LABEL[p.method]}`}
                      description={`${formatWhen(p.paid_at, tz)}${p.note ? ` · ${p.note}` : ''}`}
                    />
                  ))}
                </List>
              </>
            )}
            <Dialog isOpen={cancelOpen} onOpenChange={setCancelOpen} purpose="form" width={420}>
              <VStack gap={4} padding={4}>
                <Heading level={2}>Отменить запись?</Heading>
                <Text color="secondary">
                  {b.customer_name}, {b.service_name}, {formatWhen(b.start_at, tz)}. Время освободится для записи. Клиенту лучше позвонить.
                </Text>
                <TextInput label="Причина отмены" isOptional value={reason} onChange={setReason} />
                <HStack gap={2} justify="end">
                  <Button label="Не отменять" variant="ghost" onClick={() => setCancelOpen(false)} />
                  <Button label="Отменить запись" variant="destructive" isLoading={cancel.isPending} onClick={() => cancel.mutate()} />
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
    onError: e => setError(e instanceof Error && 'issues' in e ? 'Проверьте сумму' : errorText(e)),
  });
  return (
    <VStack gap={4}>
      <Heading level={2}>{kind === 'payment' ? 'Оплата' : 'Возврат'}</Heading>
      <Text color="secondary">
        {booking.customer_name}, {booking.service_name}. Получено: {formatMoney(net, tenant.currency)}
        {booking.status !== 'cancelled' && booking.balance > 0 ? `, осталось ${formatMoney(booking.balance, tenant.currency)}` : ''}.
      </Text>
      <SegmentedControl label="Тип операции" value={kind} onChange={v => setKind(v as 'payment' | 'refund')} layout="fill">
        {booking.status !== 'cancelled' && <SegmentedControlItem value="payment" label="Оплата" />}
        <SegmentedControlItem value="refund" label="Возврат" isDisabled={net <= 0} />
      </SegmentedControl>
      <FormLayout>
        <NumberInput label="Сумма" value={amount} onChange={setAmount} min={1} step={100} formatValue={v => formatMoney(v, tenant.currency)} />
        <Selector
          label="Способ"
          value={method}
          onChange={v => v && setMethod(v)}
          options={Object.entries(METHOD_LABEL).map(([value, label]) => ({value, label}))}
        />
        <TextInput label="Комментарий" isOptional value={note} onChange={setNote} />
      </FormLayout>
      {error && <Banner status="error" title={error} collapsible={false} />}
      <HStack gap={2}>
        <Button label="Назад" variant="ghost" onClick={onBack} style={{flexShrink: 0}} />
        <Button label={kind === 'payment' ? 'Записать оплату' : 'Оформить возврат'} variant="primary" width="100%" isLoading={save.isPending} onClick={() => save.mutate()} />
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
        <Heading level={2}>Перенос записи</Heading>
        <Text color="secondary">
          Сейчас: {formatWhen(booking.start_at, tenant.timezone)}. Если новое время займут, запись останется на прежнем месте.
        </Text>
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
        <Button label="Назад" variant="ghost" onClick={onBack} style={{flexShrink: 0}} />
        <Button
          label={start ? `Перенести на ${formatWhen(start, tenant.timezone)}` : 'Выберите время'}
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
