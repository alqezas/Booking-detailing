/**
 * «Гроші»: what came in for a day / week / month, order counts, money still
 * expected and the payments list. Read-only; RLS lets only admins read orders.
 */
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Heading, Text} from '@astryxdesign/core/Text';
import {CaretLeft, CaretRight} from '@phosphor-icons/react';
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {Loading} from '../../components/Status.tsx';
import {formatUah, kyivDateTime, kyivToday} from '../../lib/format.ts';
import {moneyStats, periodBounds, periodLabel, periodUtc, shiftAnchor, topProducts, type MoneyEntry, type MoneyOrder, type Period, type Reversal, type SoldLine, type StatusChange} from '../../lib/money.ts';
import {admin} from '../../lib/supabase.ts';

const KIND_LABEL: Record<MoneyEntry['kind'], string> = {
  online: 'Онлайн, monobank',
  prepay: 'Передоплата',
  cod: 'Накладений платіж',
  refund: 'Повернення',
};

function StatTile({label, value, hint}: {label: string; value: string; hint?: string}) {
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

async function load(fromUtc: string, toUtc: string) {
  const db = admin();
  const [orders, changes, reversals] = await Promise.all([
    db.from('orders').select('id,number,first_name,last_name,total_kop,payment_method,payment_status,paid_at,prepay_kop,prepay_received_at,fulfillment_status,created_at').lt('created_at', toUtc).order('created_at', {ascending: false}).limit(5000),
    db.from('order_timeline').select('order_id,details,at').eq('event', 'owner.fulfillment').gte('at', fromUtc).lt('at', toUtc).limit(5000),
    db.from('payment_attempts').select('order_id,amount_kop,updated_at').eq('status', 'reversed').gte('updated_at', fromUtc).lt('updated_at', toUtc),
  ]);
  for (const r of [orders, changes, reversals]) if (r.error) throw r.error;
  const s = moneyStats(
    orders.data as MoneyOrder[],
    (changes.data ?? []).map(c => ({order_id: c.order_id, to: String((c.details as {to?: string})?.to ?? ''), at: c.at}) as StatusChange),
    (reversals.data ?? []).map(r => ({order_id: r.order_id, amount_kop: r.amount_kop, at: r.updated_at}) as Reversal),
    fromUtc,
    toUtc,
  );
  let lines: SoldLine[] = [];
  if (s.paid_order_ids.length) {
    const l = await db.from('order_lines').select('order_id,name,volume,qty,line_total_kop').in('order_id', s.paid_order_ids);
    if (l.error) throw l.error;
    lines = l.data as SoldLine[];
  }
  return {...s, top: topProducts(lines)};
}

export function AdminMoney() {
  const today = kyivToday();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(today);
  const bounds = periodBounds(period, anchor);
  const {fromUtc, toUtc} = periodUtc(bounds);
  const q = useQuery({
    queryKey: ['admin-money', fromUtc, toUtc],
    queryFn: () => load(fromUtc, toUtc),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const s = q.data;
  const isCurrent = anchor === today || (bounds.from <= today && today <= bounds.to);

  return (
    <VStack gap={5}>
      <Heading level={1}>Гроші та замовлення</Heading>
      <VStack gap={2}>
        <SegmentedControl label="Період" value={period} onChange={v => setPeriod(v as Period)} layout="fill">
          <SegmentedControlItem value="day" label="День" />
          <SegmentedControlItem value="week" label="Тиждень" />
          <SegmentedControlItem value="month" label="Місяць" />
        </SegmentedControl>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <Button label="Попередній період" isIconOnly variant="ghost" icon={<Icon icon={CaretLeft} />} onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} />
          <VStack gap={0} hAlign="center">
            <Text type="body" weight="semibold">
              {periodLabel(period, bounds, today)}
            </Text>
            {!isCurrent && <Button label="До сьогодні" variant="ghost" size="sm" onClick={() => setAnchor(today)} />}
          </VStack>
          <Button label="Наступний період" isIconOnly variant="ghost" icon={<Icon icon={CaretRight} />} onClick={() => setAnchor(shiftAnchor(period, anchor, 1))} />
        </HStack>
      </VStack>

      {q.isError ? (
        <Banner status="error" title="Не вдалося завантажити дані" description={q.error.message} collapsible={false} endContent={<Button label="Повторити" size="sm" onClick={() => void q.refetch()} />} />
      ) : !s ? (
        <Loading />
      ) : (
        <VStack gap={5}>
          <VStack gap={3}>
            <Heading level={2}>Отримано</Heading>
            <Grid columns={{minWidth: 150, max: 3}} gap={2}>
              <StatTile label="Чистими" value={formatUah(s.net_kop)} hint="надходження мінус повернення" />
              <StatTile label="Надходження" value={formatUah(s.received_kop)} hint={`оплат: ${s.entries.filter(e => e.kind !== 'refund').length}`} />
              <StatTile label="Повернення" value={formatUah(s.refunded_kop)} />
            </Grid>
            <Grid columns={{minWidth: 150, max: 3}} gap={2}>
              <StatTile label="Онлайн, monobank" value={formatUah(s.online_kop)} hint="повна оплата на сайті" />
              <StatTile label="Передоплата" value={formatUah(s.prepay_kop)} hint="позначена як отримана" />
              <StatTile label="Накладений платіж" value={formatUah(s.cod_kop)} hint="решта за отримані посилки" />
            </Grid>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Замовлення</Heading>
            <Grid columns={{minWidth: 150, max: 4}} gap={2}>
              <StatTile label="Нові" value={String(s.created)} hint="оформлено за період" />
              <StatTile label="Оплачено" value={String(s.paid)} hint="оплата або передоплата" />
              <StatTile label="Відправлено" value={String(s.shipped)} hint="передано Новій пошті" />
              <StatTile label="Скасування" value={String(s.cancelled)} />
            </Grid>
            <Grid columns={{minWidth: 150, max: 4}} gap={2}>
              <StatTile label="Отримано покупцями" value={String(s.delivered)} />
              <StatTile label="Середній чек" value={s.avg_check_kop ? formatUah(s.avg_check_kop) : '—'} hint="нові замовлення без скасованих" />
            </Grid>
          </VStack>

          <VStack gap={3}>
            <Heading level={2}>Очікується зараз</Heading>
            <Grid columns={{minWidth: 200, max: 2}} gap={2}>
              <StatTile label="Чекає оплати" value={formatUah(s.awaiting_payment_kop)} hint={`замовлень: ${s.awaiting_payment} · оплата mono або передоплата ще не надійшла`} />
              <StatTile label="Накладений платіж у дорозі" value={formatUah(s.cod_pending_kop)} hint={`замовлень: ${s.cod_pending} · решта після передоплати, ще не отримані`} />
            </Grid>
            <Text type="supporting" color="secondary">
              Це прогноз за всіма відкритими замовленнями, не лише за обраний період. Скасовані й прострочені оплати не враховуються.
            </Text>
          </VStack>

          {s.top.length > 0 && (
            <List header={<Heading level={2}>Що купували</Heading>} hasDividers>
              {s.top.map(t => (
                <ListItem key={t.name} label={t.name} description={`${t.qty} шт.`} endContent={<Text type="body" hasTabularNumbers>{formatUah(t.total_kop)}</Text>} />
              ))}
            </List>
          )}

          {s.entries.length === 0 ? (
            <Card padding={4} variant="muted">
              <VStack gap={1}>
                <Text type="label">За цей період надходжень немає</Text>
                <Text type="supporting" color="secondary">Тут зʼявляться оплати monobank, передоплати й накладені платежі.</Text>
              </VStack>
            </Card>
          ) : (
            <List header={<Heading level={2}>Надходження за період</Heading>} hasDividers>
              {s.entries.map(e => (
                <ListItem
                  key={e.key}
                  href={`/admin/zamovlennia/${e.order.id}`}
                  label={`${e.kind === 'refund' ? '−' : '+'}${formatUah(e.amount_kop)}`}
                  description={`${kyivDateTime(e.at)} · ${KIND_LABEL[e.kind]} · №${e.order.number}, ${e.order.first_name} ${e.order.last_name}`}
                />
              ))}
            </List>
          )}
        </VStack>
      )}
    </VStack>
  );
}
