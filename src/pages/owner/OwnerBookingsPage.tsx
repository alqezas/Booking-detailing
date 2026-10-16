import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {List, ListItem} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {Plus} from '@phosphor-icons/react';
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {InlineEmpty, InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {fmt, formatMoney, formatTime, todayIn} from '../../lib/format.ts';
import type {OwnerBooking} from '../../lib/types.ts';
import {STATUS_LABEL} from '../client/MyBookingPage.tsx';
import {BookingSheet} from './BookingSheet.tsx';
import {NewBookingSheet} from './NewBookingSheet.tsx';
import {ownerKey, useOwner} from './ownerContext.tsx';
import {PeriodNav, periodLabel, type Period} from './PeriodNav.tsx';

export function StatTile({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <Card padding={3}>
      <VStack gap={0.5}>
        <Text type="supporting">{label}</Text>
        <Text type="large" weight="bold" hasTabularNumbers>
          {value}
        </Text>
        {hint && <Text type="supporting">{hint}</Text>}
      </VStack>
    </Card>
  );
}

export default function OwnerBookingsPage() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => todayIn(tenant.timezone));
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The server defines the period (studio time zone); the list uses the same bounds.
  const stats = useQuery({
    queryKey: ownerKey(slug, 'stats', period, anchor),
    queryFn: () => api.stats(period, anchor),
    placeholderData: keepPreviousData,
  });
  const bookings = useQuery({
    queryKey: ownerKey(slug, 'bookings', stats.data?.from_at, stats.data?.to_at),
    queryFn: () => api.bookings(stats.data!.from_at, stats.data!.to_at),
    enabled: !!stats.data,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const byDay = useMemo(() => {
    const m = new Map<string, OwnerBooking[]>();
    for (const b of bookings.data ?? []) {
      const d = fmt(b.start_at, tenant.timezone, 'yyyy-MM-dd');
      m.set(d, [...(m.get(d) ?? []), b]);
    }
    return [...m.entries()];
  }, [bookings.data, tenant.timezone]);

  const s = stats.data;
  const cur = tenant.currency;

  return (
    <VStack>
      <Section variant="transparent" padding={4} paddingInline={0}>
        <VStack gap={4}>
          <HStack justify="between" align="center">
            <Heading level={1}>Записи</Heading>
            <Button label="Добавить запись" variant="primary" icon={<Icon icon={Plus} />} onClick={() => setCreating(true)} />
          </HStack>
          <PeriodNav
            period={period}
            onPeriod={setPeriod}
            anchor={anchor}
            onAnchor={setAnchor}
            timezone={tenant.timezone}
            label={s ? periodLabel(period, s.from_date, s.to_date, tenant.timezone) : '…'}
          />
          {stats.isError ? (
            <InlineError message={stats.error.message} onRetry={() => void stats.refetch()} />
          ) : (
            <Grid columns={{minWidth: 150, max: 4}} gap={2}>
              <StatTile label="Записей" value={s ? String(s.bookings) : '—'} />
              <StatTile label="Заездов" value={s ? String(s.arrivals) : '—'} hint="машин принято" />
              <StatTile label="Готово" value={s ? String(s.completed) : '—'} hint="работ завершено" />
              <StatTile label="Получено" value={s ? formatMoney(s.net_received, cur) : '—'} hint="за вычетом возвратов" />
            </Grid>
          )}
        </VStack>
      </Section>

      <Section variant="transparent" padding={4} paddingInline={0} paddingBlockStart={0}>
        {bookings.isPending || stats.isPending ? (
          <RowsSkeleton rows={5} height={64} />
        ) : bookings.isError ? (
          <InlineError message={bookings.error.message} onRetry={() => void bookings.refetch()} />
        ) : byDay.length === 0 ? (
          <InlineEmpty
            title="Записей нет"
            description="На этот период никто не записан."
            action={<Button label="Добавить запись" onClick={() => setCreating(true)} />}
          />
        ) : (
          <VStack gap={4}>
            {byDay.map(([day, list]) => (
              <List
                key={day}
                hasDividers
                header={
                  <Heading level={2}>
                    {periodLabel('day', day, day, tenant.timezone)}
                  </Heading>
                }
              >
                {list.map(b => {
                  const st = STATUS_LABEL[b.status];
                  return (
                    <ListItem
                      key={b.id}
                      label={b.service_name}
                      description={`${b.customer_name} · ${b.car} · ${b.resource_name}${b.balance > 0 && b.status !== 'cancelled' ? ` · к оплате ${formatMoney(b.balance, cur)}` : ''}`}
                      startContent={<Text hasTabularNumbers weight="semibold">{formatTime(b.start_at, tenant.timezone)}</Text>}
                      endContent={<Badge label={st.label} variant={st.variant} />}
                      onClick={() => setOpenId(b.id)}
                      isSelected={openId === b.id}
                    />
                  );
                })}
              </List>
            ))}
          </VStack>
        )}
      </Section>

      <BookingSheet bookingId={openId} onClose={() => setOpenId(null)} />
      <NewBookingSheet isOpen={creating} onClose={() => setCreating(false)} onCreated={id => setOpenId(id)} />
    </VStack>
  );
}
