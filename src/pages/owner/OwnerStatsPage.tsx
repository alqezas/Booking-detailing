import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {List, ListItem} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {InlineEmpty, InlineError, RowsSkeleton} from '../../components/StatusScreens.tsx';
import {formatMoney, formatWhen, todayIn} from '../../lib/format.ts';
import {StatTile} from './OwnerBookingsPage.tsx';
import {ownerKey, useOwner} from './ownerContext.tsx';
import {PeriodNav, periodLabel, type Period} from './PeriodNav.tsx';
import {msg} from '../../i18n/index.ts';
import {beautyMsg} from '../../i18n/beauty.ts';

type PaymentRow = {
  id: string;
  kind: 'payment' | 'refund';
  amount: number;
  method: string;
  paid_at: string;
  note: string;
  bookings: {service_name: string; customer_name: string; car: string} | null;
};


export default function OwnerStatsPage() {
  const tenant = useTenant();
  const {api, slug} = useOwner();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(() => todayIn(tenant.timezone));
  const cur = tenant.currency;

  const stats = useQuery({
    queryKey: ownerKey(slug, 'stats', period, anchor),
    queryFn: () => api.stats(period, anchor),
    placeholderData: keepPreviousData,
  });
  const payments = useQuery({
    queryKey: ownerKey(slug, 'payments', stats.data?.from_at, stats.data?.to_at),
    queryFn: async () => (await api.payments(stats.data!.from_at, stats.data!.to_at)) as unknown as PaymentRow[],
    enabled: !!stats.data,
    placeholderData: keepPreviousData,
  });
  const s = stats.data;

  return (
    <VStack>
      <Section variant="transparent" padding={4} paddingInline={0}>
        <VStack gap={4}>
          <Heading level={1}>{msg.stats.title}</Heading>
          <PeriodNav
            period={period}
            periods={['day', 'week', 'month']}
            onPeriod={setPeriod}
            anchor={anchor}
            onAnchor={setAnchor}
            timezone={tenant.timezone}
            label={s ? periodLabel(period, s.from_date, s.to_date, tenant.timezone) : '…'}
          />
          {stats.isError ? (
            <InlineError message={stats.error.message} onRetry={() => void stats.refetch()} />
          ) : !s ? (
            <RowsSkeleton rows={2} height={88} />
          ) : (
            <VStack gap={3}>
              <Heading level={2}>{msg.stats.received}</Heading>
              <Grid columns={{minWidth: 150, max: 3}} gap={2}>
                <StatTile label={msg.stats.net} value={formatMoney(s.net_received, cur)} hint={msg.stats.netHint} />
                <StatTile label={msg.stats.payments} value={formatMoney(s.received, cur)} />
                <StatTile label={msg.stats.refunds} value={formatMoney(s.refunded, cur)} />
              </Grid>
              <Heading level={2}>{msg.stats.cars}</Heading>
              <Grid columns={{minWidth: 150, max: 4}} gap={2}>
                <StatTile label={msg.bookings.tiles.arrivals} value={String(s.arrivals)} hint={msg.bookings.tiles.arrivalsHint} />
                <StatTile label={msg.bookings.tiles.ready} value={String(s.completed)} hint={msg.bookings.tiles.readyHint} />
                <StatTile label={msg.bookings.tiles.bookings} value={String(s.bookings)} hint={msg.stats.bookingsHint} />
                <StatTile label={msg.stats.cancelNoShow} value={`${s.cancelled} / ${s.no_show}`} />
                {s.upcoming !== undefined && <StatTile label={beautyMsg().owner.upcoming} value={String(s.upcoming)} hint={beautyMsg().owner.upcomingHint} />}
              </Grid>
              {s.upcoming_value !== undefined && (
                <StatTile label={beautyMsg().owner.upcomingValue} value={formatMoney(s.upcoming_value, cur)} hint={beautyMsg().owner.upcomingValueHint} />
              )}
              <StatTile
                label={msg.stats.expected}
                value={formatMoney(s.expected_value, cur)}
                hint={msg.stats.expectedHint}
              />
            </VStack>
          )}
        </VStack>
      </Section>
      <Section variant="transparent" padding={4} paddingInline={0} paddingBlockStart={0}>
        {payments.isPending ? (
          <RowsSkeleton rows={3} />
        ) : payments.isError ? (
          <InlineError message={payments.error.message} onRetry={() => void payments.refetch()} />
        ) : payments.data.length === 0 ? (
          <InlineEmpty title={msg.stats.noPayments} description={msg.stats.noPaymentsHint} />
        ) : (
          <List header={<Heading level={2}>{msg.stats.periodPayments}</Heading>} hasDividers>
            {payments.data.map(p => (
              <ListItem
                key={p.id}
                label={`${p.kind === 'refund' ? msg.stats.refundPrefix : '+'}${formatMoney(p.amount, cur)}`}
                description={`${formatWhen(p.paid_at, tenant.timezone)} · ${msg.methods.short[p.method] ?? p.method}${p.bookings ? ` · ${p.bookings.customer_name}, ${p.bookings.service_name}` : ''}`}
                endContent={p.note ? <Text type="supporting">{p.note}</Text> : undefined}
              />
            ))}
          </List>
        )}
      </Section>
    </VStack>
  );
}
