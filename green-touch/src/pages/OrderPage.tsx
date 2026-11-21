import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {useParams} from 'react-router';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState, Loading} from '../components/Status.tsx';
import {ApiError, orderStatus, payAgain} from '../lib/api.ts';
import {orderToken, rememberOrder, useMeta, useOnline} from '../lib/browser.ts';
import {FULFILLMENT_LABEL, PAYMENT_LABEL, formatUah, kyivDateTime} from '../lib/format.ts';

function tokenFor(id: string): string | null {
  // A link from the order page may carry the token in the fragment (never sent to servers).
  const m = location.hash.match(/(?:^#|&)t=([A-Za-z0-9_-]{20,100})/);
  if (m) {
    rememberOrder(id, m[1]!);
    history.replaceState(null, '', location.pathname);
    return m[1]!;
  }
  return orderToken(id);
}

export default function OrderPage() {
  const {id = ''} = useParams();
  useMeta({title: 'Статус замовлення', noindex: true});
  const online = useOnline();
  const [token] = useState(() => tokenFor(id));
  const [startedAt] = useState(() => Date.now());
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => orderStatus(id, token!),
    enabled: !!token && online,
    // Coming back from the bank: poll the server status (the redirect itself proves nothing).
    refetchInterval: query => {
      const s = query.state.data?.order.payment_status;
      return (s === 'awaiting' || s === 'processing') && Date.now() - startedAt < 5 * 60_000 ? 4000 : false;
    },
  });
  const pay = useMutation({
    mutationFn: () => payAgain(id, token!),
    onSuccess: r => {
      if (r.payment.state === 'redirect') window.location.assign(r.payment.page_url);
      else void q.refetch();
    },
  });

  if (!token) {
    return (
      <Page width={760}>
        <EmptyState title="Немає доступу до замовлення" description="Статус видно в браузері, з якого оформлено замовлення, або за особистим посиланням. Якщо потрібна допомога — звʼяжіться з нами." actions={<Button label="Контакти" href="/kontakty" />} />
      </Page>
    );
  }
  if (!online && !q.data) return <Page width={760}><Banner status="warning" title="Немає зʼєднання" description="Статус оплати перевіряється на сервері — підключіться до мережі." collapsible={false} /></Page>;
  if (q.isPending) return <Loading label="Перевіряємо статус замовлення…" />;
  if (q.isError) return q.error instanceof ApiError && q.error.code === 'ORDER_NOT_FOUND' ? <Page width={760}><EmptyState title="Замовлення не знайдено" /></Page> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const o = q.data.order;
  const p = PAYMENT_LABEL[o.payment_status] ?? {label: o.payment_status, variant: 'neutral' as const};
  const link = `${location.origin}/zamovlennia/${o.id}#t=${token}`;

  return (
    <Page width={760}>
      <VStack gap={2}>
        <Heading level={1}>Замовлення №{o.number}</Heading>
        <Text type="body" color="secondary">
          від {kyivDateTime(o.created_at)} (за київським часом)
        </Text>
      </VStack>
      {o.payment_method === 'prepay_manual' && !o.prepay_received && o.fulfillment_status !== 'cancelled' && (
        <Banner
          status="info"
          title={`Замовлення прийнято. Чекайте повідомлення у Viber`}
          description={`Ми напишемо вам на номер з замовлення і надішлемо реквізити для передоплати ${formatUah(o.prepay_kop)}. Решту ${formatUah(o.cod_kop)} ви сплатите при отриманні на Новій пошті.`}
          collapsible={false}
        />
      )}
      {o.payment_method === 'prepay_manual' && o.prepay_received && (
        <Banner status="success" title={`Передоплату ${formatUah(o.prepay_kop)} отримано`} description={`Засоби виготовляються під ваше замовлення. При отриманні на Новій пошті до сплати ${formatUah(o.cod_kop)}.`} collapsible={false} />
      )}
      {o.payment_status === 'paid' && !o.needs_review && <Banner status="success" title="Оплату підтверджено банком" description="Дякуємо! Засоби виготовляються під ваше замовлення; після відправлення тут зʼявиться ТТН." collapsible={false} />}
      {o.payment_status === 'paid' && o.needs_review && <Banner status="warning" title="Оплату отримано, замовлення перевіряє менеджер" description="Ми звʼяжемося з вами щодо відправлення." collapsible={false} />}
      {(o.payment_status === 'awaiting' || o.payment_status === 'processing') && (
        <Banner status="info" title="Очікуємо підтвердження оплати від банку" description="Сторінка оновиться автоматично. Якщо ви не завершили оплату, можна повернутися до неї." collapsible={false} />
      )}
      {(o.payment_status === 'failed' || o.payment_status === 'expired' || o.payment_status === 'unpaid') && o.can_pay && (
        <Banner status="warning" title={o.payment_status === 'unpaid' ? 'Замовлення збережено, але не оплачено' : p.label} description="Можна безпечно спробувати оплатити це саме замовлення ще раз." collapsible={false} />
      )}
      {pay.isError && <Banner status="error" title={pay.error.message} collapsible={false} />}
      {pay.data?.payment.state === 'unavailable' && <Banner status="error" title="Оплата тимчасово недоступна" description="Замовлення збережено. Спробуйте трохи пізніше." collapsible={false} />}
      {o.can_pay && <Button label={`Оплатити ${formatUah(o.total_kop)}`} variant="primary" size="lg" isLoading={pay.isPending} isDisabled={!online} onClick={() => pay.mutate()} />}

      <Card padding={5}>
        <MetadataList orientation="horizontal">
          <MetadataListItem label="Оплата">
            {o.payment_method === 'prepay_manual' ? (
              <Badge variant={o.prepay_received ? 'success' : 'warning'} label={o.prepay_received ? `Передоплату ${formatUah(o.prepay_kop)} отримано` : `Очікуємо передоплату ${formatUah(o.prepay_kop)}`} />
            ) : (
              <Badge variant={p.variant} label={p.label} />
            )}
          </MetadataListItem>
          {o.payment_method === 'prepay_manual' && (
            <MetadataListItem label="При отриманні (накладений платіж)">
              <Text type="body">{formatUah(o.cod_kop)}</Text>
            </MetadataListItem>
          )}
          <MetadataListItem label="Обробка">
            <Text type="body">{FULFILLMENT_LABEL[o.fulfillment_status] ?? o.fulfillment_status}</Text>
          </MetadataListItem>
          {o.ttn && (
            <MetadataListItem label="ТТН Нової пошти">
              <Text type="body">{o.ttn}</Text>
            </MetadataListItem>
          )}
          <MetadataListItem label="Доставка">
            <Text type="body">
              {o.delivery.method === 'np_postomat' ? 'Поштомат' : 'Відділення'}: {o.delivery.warehouse}, {o.delivery.settlement}
              {o.delivery.area ? ` (${o.delivery.area} обл.)` : ''}
            </Text>
          </MetadataListItem>
        </MetadataList>
      </Card>

      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Склад</Heading>
          {o.lines.map((l, i) => (
            <VStack key={i} gap={1}>
              <HStack hAlign="between" gap={3}>
                <Text type="body">
                  {l.name}
                  {l.volume ? `, ${l.volume}` : ''} × {l.qty}
                </Text>
                <Text type="body">{formatUah(l.line_total_kop)}</Text>
              </HStack>
              {l.components.length > 0 && (
                <Text type="supporting" color="secondary">
                  Набір: {l.components.map(c => `${c.name}${c.qty > 1 ? ` ×${c.qty}` : ''}`).join(', ')}
                </Text>
              )}
            </VStack>
          ))}
          <Divider />
          {o.discount_kop > 0 && (
            <HStack hAlign="between">
              <Text type="body">Економія на наборах</Text>
              <Text type="body">−{formatUah(o.discount_kop)}</Text>
            </HStack>
          )}
          <HStack hAlign="between">
            <Text type="label">Разом за товари</Text>
            <Text type="large" weight="bold">
              {formatUah(o.total_kop)}
            </Text>
          </HStack>
          <Text type="supporting" color="secondary">
            Доставку сплачує отримувач за тарифами Нової пошти.
          </Text>
        </VStack>
      </Card>
      <VStack gap={2}>
        <Text type="label">Особисте посилання на це замовлення</Text>
        <Text type="supporting" color="secondary">
          Збережіть його, щоб перевірити статус з іншого пристрою. Не пересилайте стороннім.
        </Text>
        <Button label="Скопіювати посилання" variant="secondary" onClick={() => void navigator.clipboard?.writeText(link)} />
      </VStack>
    </Page>
  );
}
