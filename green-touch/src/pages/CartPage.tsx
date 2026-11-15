import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Text} from '@astryxdesign/core/Text';
import {Trash} from '@phosphor-icons/react';
import {useQuery} from '@tanstack/react-query';
import {useEffect} from 'react';
import {Page} from '../components/ShopLayout.tsx';
import {PageTitle, ProductImage, QtyStepper, itemHref} from '../components/ui.tsx';
import {quoteCart} from '../lib/api.ts';
import {useMeta, useOnline} from '../lib/browser.ts';
import {cartPayload, dispatchCart, useCart, type CartLine} from '../lib/cart.ts';
import {formatUah} from '../lib/format.ts';
import type {Quote, QuoteLine} from '../lib/types.ts';

/** Live server quote of the local cart (prices, kit discount, availability). */
export function useQuote(enabled = true) {
  const cart = useCart();
  const online = useOnline();
  const payload = cartPayload(cart);
  return useQuery({
    queryKey: ['quote', JSON.stringify(payload)],
    queryFn: () => quoteCart(payload),
    enabled: enabled && online && payload.length > 0,
    staleTime: 15_000,
  });
}

/** What changed between the buyer's snapshot and the server quote. */
export function priceChanges(lines: CartLine[], quote: Quote | undefined): string[] {
  if (!quote) return [];
  const out: string[] = [];
  for (const l of lines) {
    const q = quote.lines.find(x => x.id === l.id);
    if (q && q.unit_price_kop != null && q.unit_price_kop !== l.price_kop) out.push(`${q.name}: ${formatUah(l.price_kop)} → ${formatUah(q.unit_price_kop)}`);
  }
  return out;
}

function Line({line, q}: {line: CartLine; q: QuoteLine | undefined}) {
  const price = q?.unit_price_kop ?? line.price_kop;
  const unavailable = q && (!q.purchasable || !q.available);
  return (
    <Grid columns={{minWidth: 96, max: 1}} gap={3}>
      <HStack gap={3} vAlign="start">
        <Card padding={0} width={96}>
          <ProductImage path={line.image} alt={line.name} ratio={1} />
        </Card>
        <VStack gap={1} width="100%">
          <Link href={itemHref(line)} label={line.name} color="primary">{line.name}</Link>
          <Text type="supporting" color="secondary">
            {[line.volume, line.kind === 'kit' ? 'Набір догляду' : null].filter(Boolean).join(' · ')}
          </Text>
          {unavailable && <Banner status="error" title={q!.purchasable ? 'Тимчасово не приймаємо замовлення' : 'Товар знято з продажу'} collapsible={false} />}
          {q?.components?.length ? (
            <Collapsible trigger={<Text type="supporting">Склад набору</Text>} defaultIsOpen={false}>
              <VStack gap={0.5} as="ul">
                {q.components.map(c => (
                  <Text key={c.name} as="p" type="supporting" color="secondary">
                    {c.name}
                    {c.volume ? `, ${c.volume}` : ''} × {c.qty}
                  </Text>
                ))}
              </VStack>
            </Collapsible>
          ) : null}
          <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
            <QtyStepper value={line.qty} onChange={n => dispatchCart({type: 'set', id: line.id, qty: n})} label={line.name} />
            <VStack gap={0} hAlign="end">
              <Text type="body" weight="semibold">
                {formatUah(price * line.qty)}
              </Text>
              {line.kind === 'kit' && q?.unit_base_kop != null && q.unit_base_kop > price && (
                <Text type="supporting" color="secondary">
                  Окремо <Text type="supporting" color="secondary" hasStrikethrough>{formatUah(q.unit_base_kop * line.qty)}</Text>
                </Text>
              )}
            </VStack>
            <Button label={`Видалити ${line.name}`} variant="ghost" isIconOnly icon={<Icon icon={Trash} />} onClick={() => dispatchCart({type: 'remove', id: line.id})} />
          </HStack>
        </VStack>
      </HStack>
    </Grid>
  );
}

export function Totals({quote, fallbackTotal}: {quote: Quote | undefined; fallbackTotal: number}) {
  return (
    <VStack gap={2}>
      {quote && quote.discount_kop > 0 && (
        <>
          <HStack hAlign="between">
            <Text type="body">Окремо</Text>
            <Text type="body">{formatUah(quote.subtotal_kop)}</Text>
          </HStack>
          <HStack hAlign="between">
            <Text type="body">Економія на наборах</Text>
            <Text type="body" color="accent">
              −{formatUah(quote.discount_kop)}
            </Text>
          </HStack>
        </>
      )}
      <HStack hAlign="between" vAlign="center">
        <Text type="label">Разом за товари</Text>
        <Text type="display-3" weight="bold">
          {formatUah(quote?.total_kop ?? fallbackTotal)}
        </Text>
      </HStack>
      <Text type="supporting" color="secondary">
        Доставка Новою поштою не входить у суму: її сплачує отримувач за тарифами перевізника.
      </Text>
    </VStack>
  );
}

export default function CartPage() {
  useMeta({title: 'Кошик', path: '/koshyk', noindex: true});
  const cart = useCart();
  const online = useOnline();
  const quote = useQuote();
  const changes = priceChanges(cart.lines, quote.data);

  // Keep the local snapshot in line with the server after the buyer has seen the change.
  useEffect(() => {
    if (!quote.data || changes.length === 0) return;
    const id = setTimeout(() => {
      const prices = Object.fromEntries(
        quote.data!.lines.filter(l => l.unit_price_kop != null).map(l => [l.id, {price_kop: l.unit_price_kop!, base_kop: l.unit_base_kop, name: l.name!}]),
      );
      dispatchCart({type: 'refresh', prices});
    }, 8000);
    return () => clearTimeout(id);
  }, [quote.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cart.lines.length === 0) {
    return (
      <Page width={900}>
        <EmptyState title="Кошик порожній" description="Додайте товари або набори з каталогу." actions={<Button label="До каталогу" variant="primary" href="/katalog" />} />
      </Page>
    );
  }
  const snapshotTotal = cart.lines.reduce((s, l) => s + l.price_kop * l.qty, 0);
  const canCheckout = online && quote.data?.ok === true;

  return (
    <Page width={900}>
      <PageTitle title="Кошик" />
      {!online && <Banner status="warning" title="Ви офлайн" description="Показано збережені ціни. Актуальні ціни й наявність перевіримо після підключення; оформлення зараз недоступне." collapsible={false} />}
      {changes.length > 0 && <Banner status="warning" title="Ціни змінилися" description={changes.join('; ')} collapsible={false} />}
      {quote.isError && <Banner status="error" title={quote.error.message} collapsible={false} />}
      <Card padding={4}>
        <VStack gap={4}>
          {cart.lines.map((l, i) => (
            <VStack key={l.id} gap={4}>
              {i > 0 && <Divider />}
              <Line line={l} q={quote.data?.lines.find(x => x.id === l.id)} />
            </VStack>
          ))}
        </VStack>
      </Card>
      <Card padding={5}>
        <VStack gap={4}>
          <Totals quote={quote.data} fallbackTotal={snapshotTotal} />
          <Button label="Оформити замовлення" variant="primary" size="lg" width="100%" href={canCheckout ? '/oformlennia' : undefined} isDisabled={!canCheckout} isLoading={quote.isFetching && !quote.data} />
          <Button label="Продовжити покупки" variant="ghost" href="/katalog" width="100%" />
        </VStack>
      </Card>
    </Page>
  );
}
