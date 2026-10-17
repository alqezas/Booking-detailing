import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {CaretRight, LinkSimple, Phone} from '@phosphor-icons/react';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useEffect, useMemo, useState} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {PageContainer, PageTitle} from '../../components/layout/Page.tsx';
import {RevealSection} from '../../components/home/Sections.tsx';
import {useBookingFlow} from '../../components/booking/BookingFlow.tsx';
import {BookingSummary} from '../../components/booking/BookingSummary.tsx';
import {ReminderOffer} from '../../components/booking/ReminderOffer.tsx';
import {InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {cancelBooking, getBooking} from '../../lib/api/public.ts';
import {forgetBooking, listBookings, rememberBooking, type StoredBooking} from '../../lib/booking-store.ts';
import {errorText} from '../../lib/errors.ts';
import {formatPhone, formatWhen} from '../../lib/format.ts';
import {bookingKey, usePublicBooking} from '../../lib/queries.ts';
import type {BookingStatus, PublicBooking} from '../../lib/types.ts';

export const STATUS_LABEL: Record<BookingStatus, {label: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral'}> = {
  confirmed: {label: 'Подтверждена', variant: 'info'},
  arrived: {label: 'Машина принята', variant: 'warning'},
  ready: {label: 'Готово', variant: 'success'},
  cancelled: {label: 'Отменена', variant: 'neutral'},
  no_show: {label: 'Неявка', variant: 'error'},
};

export default function MyBookingPage() {
  const t = useTenant();
  const navigate = useNavigate();
  const {hash, key: locationKey} = useLocation();
  const [params, setParams] = useSearchParams();
  const [stored, setStored] = useState<StoredBooking[]>(() => listBookings(t.slug));
  // Re-read the device's bookings on every navigation: a booking made from the
  // sheet on this very page lands here without remounting it.
  useEffect(() => setStored(listBookings(t.slug)), [t.slug, locationKey]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const flow = useBookingFlow();

  // A shared link /s/<slug>/my#t=<token> opens the booking on any device.
  useEffect(() => {
    const token = new URLSearchParams(hash.slice(1)).get('t');
    if (!token) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    getBooking(t.slug, token)
      .then(b => {
        rememberBooking(t.slug, {id: b.id, token, startAt: b.start_at, serviceName: b.service_name});
        setStored(listBookings(t.slug));
        setParams({b: b.id}, {replace: true});
      })
      .catch(e => setLinkError(errorText(e)));
  }, [hash, t.slug, setParams]);

  const selectedId = params.get('b') ?? stored.find(b => new Date(b.startAt) > new Date())?.id ?? stored[0]?.id ?? null;
  const selected = stored.find(b => b.id === selectedId) ?? null;
  const upcoming = useMemo(() => stored.filter(b => b.id !== selectedId), [stored, selectedId]);

  // Same structure as the home page: page title, then sections whose headings
  // share one content line, cards spanning the whole column.
  return (
    <PageContainer>
      <PageTitle title="Моя запись" />
      <VStack gap={8} style={{paddingBlockEnd: 'var(--spacing-6)'}}>
        {linkError && <InlineError message={linkError} />}
        {!selected ? (
          <RevealSection title="Записей пока нет" id="my-empty-title">
            <Card padding={4}>
              <VStack gap={3}>
                <Text color="secondary">
                  Запишитесь — подробности появятся здесь. Если записывались с другого телефона, откройте ссылку на запись.
                </Text>
                <Button label="Выбрать услугу и время" variant="primary" size="lg" width="100%" onClick={() => flow.open()} />
              </VStack>
            </Card>
          </RevealSection>
        ) : (
          <RevealSection title="Ваша запись" id="my-current-title">
            <BookingDetails
              key={selected.id}
              entry={selected}
              onGone={() => {
                forgetBooking(t.slug, selected.id);
                setStored(listBookings(t.slug));
                setParams({}, {replace: true});
              }}
            />
          </RevealSection>
        )}
        {upcoming.length > 0 && (
          <RevealSection title="Другие записи" id="my-other-title">
            <Card padding={0}>
              <List hasDividers>
                {upcoming.map(b => (
                  <ListItem
                    key={b.id}
                    label={b.serviceName}
                    description={formatWhen(b.startAt, t.timezone)}
                    endContent={<Icon icon={CaretRight} color="secondary" />}
                    onClick={() => navigate(`/s/${t.slug}/my?b=${b.id}`)}
                  />
                ))}
              </List>
            </Card>
          </RevealSection>
        )}
      </VStack>
    </PageContainer>
  );
}

function BookingDetails({entry, onGone}: {entry: StoredBooking; onGone: () => void}) {
  const t = useTenant();
  const qc = useQueryClient();
  const showToast = useToast();
  const q = usePublicBooking(t.slug, entry.token);
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () => cancelBooking(t.slug, entry.token),
    onSuccess: b => {
      qc.setQueryData(bookingKey(t.slug, entry.token), b);
      void qc.invalidateQueries({queryKey: ['availability', t.slug]});
      setConfirming(false);
      showToast({body: 'Запись отменена'});
    },
  });

  if (q.isPending) {
    return (
      <Section variant="transparent" padding={0}>
        <RowsSkeleton rows={4} />
      </Section>
    );
  }
  if (q.isError) {
    const gone = (q.error as {status?: number}).status === 404;
    return (
      <Section variant="transparent" padding={0}>
        <InlineError
          message={gone ? 'Запись не найдена: возможно, ссылка устарела.' : q.error.message}
          onRetry={gone ? onGone : () => void q.refetch()}
        />
      </Section>
    );
  }
  const b: PublicBooking = q.data;
  const status = STATUS_LABEL[b.status];
  const shareUrl = `${location.origin}/s/${t.slug}/my#t=${entry.token}`;

  return (
    <Section variant="transparent" padding={0}>
      <Card padding={4}>
        <VStack gap={4}>
          <HStack justify="between" align="center" gap={2}>
            <Heading level={3}>{b.service_name}</Heading>
            <Badge label={status.label} variant={status.variant} />
          </HStack>
          {b.is_demo && <Text color="secondary">Демонстрационная запись образца приложения.</Text>}
          <BookingSummary
            serviceName={b.service_name}
            price={b.price}
            priceFrom={b.price_from}
            durationMinutes={b.duration_minutes}
            startAt={b.start_at}
            endAt={b.end_at}
            timezone={t.timezone}
            currency={t.currency}
            customer={{name: b.customer_name, phone: b.customer_phone, car: b.car}}
          />
          <Text color="secondary">Адрес: {b.tenant.address}</Text>
          {b.status === 'confirmed' && <ReminderOffer booking={b} token={entry.token} />}
          <HStack gap={2} wrap="wrap">
            <Button label={`Позвонить в студию ${formatPhone(t.phone)}`} icon={<Icon icon={Phone} />} href={`tel:${t.phone}`}>
              Позвонить в студию
            </Button>
            <Button
              label="Скопировать ссылку на запись"
              variant="ghost"
              icon={<Icon icon={LinkSimple} />}
              clickAction={async () => {
                await navigator.clipboard.writeText(shareUrl);
                showToast({body: 'Ссылка скопирована — по ней запись откроется на любом устройстве'});
              }}
            />
          </HStack>
          {b.status === 'confirmed' &&
            (b.can_cancel ? (
              <Button label="Отменить запись" variant="destructive" onClick={() => setConfirming(true)} />
            ) : (
              <Text type="supporting">
                Онлайн-отмена доступна до {formatWhen(b.cancel_deadline, t.timezone)}. Сейчас — только по телефону студии.
              </Text>
            ))}
          {cancel.isError && (
            <Text color="accent" role="alert">
              {errorText(cancel.error)}
            </Text>
          )}
        </VStack>
      </Card>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Отменить запись?"
        description={`${b.service_name}, ${formatWhen(b.start_at, t.timezone)}. Время освободится для других клиентов.`}
        actionLabel="Отменить запись"
        cancelLabel="Не отменять"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
    </Section>
  );
}
