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

type PaymentRow = {
  id: string;
  kind: 'payment' | 'refund';
  amount: number;
  method: string;
  paid_at: string;
  note: string;
  bookings: {service_name: string; customer_name: string; car: string} | null;
};

const METHOD: Record<string, string> = {cash: 'наличные', card: 'карта', transfer: 'перевод', other: 'другое'};

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
          <Heading level={1}>Деньги и заезды</Heading>
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
              <Heading level={2}>Получено</Heading>
              <Grid columns={{minWidth: 150, max: 3}} gap={2}>
                <StatTile label="Чистыми" value={formatMoney(s.net_received, cur)} hint="оплаты минус возвраты" />
                <StatTile label="Оплаты" value={formatMoney(s.received, cur)} />
                <StatTile label="Возвраты" value={formatMoney(s.refunded, cur)} />
              </Grid>
              <Heading level={2}>Машины</Heading>
              <Grid columns={{minWidth: 150, max: 4}} gap={2}>
                <StatTile label="Заездов" value={String(s.arrivals)} hint="машин принято" />
                <StatTile label="Готово" value={String(s.completed)} hint="работ завершено" />
                <StatTile label="Записей" value={String(s.bookings)} hint="на этот период" />
                <StatTile label="Отмены / неявки" value={`${s.cancelled} / ${s.no_show}`} />
              </Grid>
              <StatTile
                label="Ожидаемая стоимость записей"
                value={formatMoney(s.expected_value, cur)}
                hint="Прогноз по ценам записей периода. Это не выручка: деньги считаются только после оплаты."
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
          <InlineEmpty title="Платежей нет" description="За этот период оплаты не вносились." />
        ) : (
          <List header={<Heading level={2}>Платежи периода</Heading>} hasDividers>
            {payments.data.map(p => (
              <ListItem
                key={p.id}
                label={`${p.kind === 'refund' ? 'Возврат −' : '+'}${formatMoney(p.amount, cur)}`}
                description={`${formatWhen(p.paid_at, tenant.timezone)} · ${METHOD[p.method] ?? p.method}${p.bookings ? ` · ${p.bookings.customer_name}, ${p.bookings.service_name}` : ''}`}
                endContent={p.note ? <Text type="supporting">{p.note}</Text> : undefined}
              />
            ))}
          </List>
        )}
      </Section>
    </VStack>
  );
}
