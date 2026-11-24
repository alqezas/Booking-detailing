import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
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
import {ArrowsClockwise, CaretRight, LinkSimple, Phone} from '@phosphor-icons/react';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useEffect, useMemo, useState} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {PageContainer, PageTitle} from '../../components/layout/Page.tsx';
import {RevealSection} from '../../components/home/Sections.tsx';
import {useBookingFlow} from '../../components/booking/BookingFlow.tsx';
import {BookingSummary} from '../../components/booking/BookingSummary.tsx';
import {tireRows} from '../../components/tire/tireRows.ts';
import {ReminderOffer} from '../../components/booking/ReminderOffer.tsx';
import {InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {cancelBooking, getBooking, getRescheduleOptions, rescheduleBooking} from '../../lib/api/public.ts';
import {SlotPicker} from '../../components/booking/SlotPicker.tsx';
import {beautyMsg} from '../../i18n/beauty.ts';
import {forgetBooking, listBookings, rememberBooking, type StoredBooking} from '../../lib/booking-store.ts';
import {errorText} from '../../lib/errors.ts';
import {formatPhone, formatWhen, hasPhone} from '../../lib/format.ts';
import {bookingKey, usePublicBooking} from '../../lib/queries.ts';
import {isAddonsParams, type BookingStatus, type PublicBooking} from '../../lib/types.ts';
import {msg} from '../../i18n/index.ts';

const STATUS_VARIANT: Record<BookingStatus, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  confirmed: 'info',
  arrived: 'warning',
  ready: 'success',
  cancelled: 'neutral',
  no_show: 'error',
};

/** Badge text and colour of a booking status, in the studio language. */
export const statusLabel = (s: BookingStatus) => ({label: msg.status[s], variant: STATUS_VARIANT[s]});

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
      <PageTitle title={msg.my.title} />
      <VStack gap={8} style={{paddingBlockEnd: 'var(--spacing-6)'}}>
        {linkError && <InlineError message={linkError} />}
        {!selected ? (
          <RevealSection title={msg.my.empty} id="my-empty-title">
            <Card padding={4}>
              <VStack gap={3}>
                <Text color="secondary">{msg.my.emptyText}</Text>
                <Button label={msg.home.pickServiceAndTime} variant="primary" size="lg" width="100%" onClick={() => flow.open()} />
              </VStack>
            </Card>
          </RevealSection>
        ) : (
          <RevealSection title={msg.my.current} id="my-current-title">
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
          <RevealSection title={msg.my.other} id="my-other-title">
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
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const B = beautyMsg();
  // Moving is atomic on the server: a failure leaves the booking where it was.
  const move = useMutation({
    mutationFn: (startAt: string) => rescheduleBooking(t.slug, entry.token, startAt),
    onSuccess: b => {
      qc.setQueryData(bookingKey(t.slug, entry.token), b);
      rememberBooking(t.slug, {...entry, startAt: b.start_at});
      void qc.invalidateQueries({queryKey: ['availability', t.slug]});
      setMoving(false);
      setMoveTo(null);
      showToast({body: B.my.rescheduled});
    },
    onError: e => {
      setMoveTo(null);
      setMoveNotice(errorText(e));
      void qc.invalidateQueries({queryKey: ['availability', t.slug, 'custom', 'move']});
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelBooking(t.slug, entry.token),
    onSuccess: b => {
      qc.setQueryData(bookingKey(t.slug, entry.token), b);
      void qc.invalidateQueries({queryKey: ['availability', t.slug]});
      setConfirming(false);
      showToast({body: msg.my.cancelled});
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
          message={gone ? msg.my.linkGone : q.error.message}
          onRetry={gone ? onGone : () => void q.refetch()}
        />
      </Section>
    );
  }
  const b: PublicBooking = q.data;
  const status = statusLabel(b.status);
  const shareUrl = `${location.origin}/s/${t.slug}/my#t=${entry.token}`;

  return (
    <Section variant="transparent" padding={0}>
      <Card padding={4}>
        <VStack gap={4}>
          <HStack justify="between" align="center" gap={2}>
            <Heading level={3}>{b.service_name}</Heading>
            <Badge label={status.label} variant={status.variant} />
          </HStack>
          {b.is_demo && <Text color="secondary">{msg.my.demo}</Text>}
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
            extra={[
              ...tireRows(b),
              ...(isAddonsParams(b.tire_params) && b.tire_params.addons.length
                ? [{label: B.flow.options, value: b.tire_params.addons.map(a => a.name).join(', ')}]
                : []),
              ...(b.resource_role === 'master' ? [{label: B.flow.master2, value: b.resource_name}] : []),
              ...(b.comment && t.kind === 'beauty' ? [{label: B.flow.commentLabel, value: b.comment}] : []),
            ]}
          />
          <Text color="secondary">{msg.my.address(b.tenant.address)}</Text>
          {b.status === 'confirmed' && <ReminderOffer booking={b} token={entry.token} />}
          <HStack gap={2} wrap="wrap">
            {hasPhone(t.phone) && (
              <Button label={msg.my.callStudioLabel(formatPhone(t.phone))} icon={<Icon icon={Phone} />} href={`tel:${t.phone}`}>
              {msg.my.callStudio}
            </Button>
            )}
            <Button
              label={msg.my.copyLink}
              variant="ghost"
              icon={<Icon icon={LinkSimple} />}
              clickAction={async () => {
                await navigator.clipboard.writeText(shareUrl);
                showToast({body: msg.my.copied});
              }}
            />
          </HStack>
          {b.status === 'confirmed' && b.can_reschedule && t.kind === 'beauty' && (
            <Button
              label={B.my.reschedule}
              variant="secondary"
              icon={<Icon icon={ArrowsClockwise} />}
              onClick={() => {
                setMoveNotice(null);
                setMoveTo(null);
                setMoving(true);
              }}
            />
          )}
          {b.status === 'confirmed' &&
            (b.can_cancel ? (
              <>
                {t.kind === 'beauty' && <Text type="supporting">{B.my.rescheduleUntil(formatWhen(b.cancel_deadline, t.timezone))}</Text>}
                <Button label={msg.my.cancel} variant="destructive" onClick={() => setConfirming(true)} />
              </>
            ) : (
              <Text type="supporting">{msg.my.cancelUntil(formatWhen(b.cancel_deadline, t.timezone))}</Text>
            ))}
          {cancel.isError && (
            <Text color="accent" role="alert">
              {errorText(cancel.error)}
            </Text>
          )}
        </VStack>
      </Card>
      <BottomSheet isOpen={moving} onOpenChange={setMoving} label={B.my.rescheduleTitle} height="tall">
        {moving && (
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={2}>{B.my.rescheduleTitle}</Heading>
              <Text color="secondary">{B.my.rescheduleLead(formatWhen(b.start_at, t.timezone))}</Text>
              {isAddonsParams(b.tire_params) && b.tire_params.master_choice === 'specific' && <Text type="supporting">{B.my.sameMaster}</Text>}
            </VStack>
            <SlotPicker
              slug={t.slug}
              serviceId={b.service_id ?? b.id}
              timezone={t.timezone}
              horizonDays={t.booking.horizon_days}
              load={(from, days) => getRescheduleOptions(t.slug, entry.token, from, days)}
              loadKey={['move', b.id, b.start_at]}
              value={moveTo}
              onChange={v => {
                setMoveTo(v);
                setMoveNotice(null);
              }}
              notice={moveNotice}
              dayParts={B.flow.dayParts}
            />
            <HStack gap={2}>
              <Button label={msg.common.cancel} variant="ghost" onClick={() => setMoving(false)} style={{flexShrink: 0}} />
              <Button
                label={moveTo ? B.my.rescheduleTo(formatWhen(moveTo, t.timezone)) : B.my.reschedule}
                variant="primary"
                width="100%"
                isDisabled={!moveTo}
                isLoading={move.isPending}
                onClick={() => moveTo && !move.isPending && move.mutate(moveTo)}
              />
            </HStack>
          </VStack>
        )}
      </BottomSheet>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={msg.my.cancelTitle}
        description={msg.my.cancelText(b.service_name, formatWhen(b.start_at, t.timezone))}
        actionLabel={msg.my.cancel}
        cancelLabel={msg.my.keep}
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
    </Section>
  );
}
