import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Breadcrumbs, BreadcrumbItem} from '@astryxdesign/core/Breadcrumbs';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Collapsible, CollapsibleGroup} from '@astryxdesign/core/Collapsible';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {SelectableCard} from '@astryxdesign/core/SelectableCard';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {Tag} from '@phosphor-icons/react';
import {useQuery} from '@tanstack/react-query';
import {useState, type CSSProperties} from 'react';
import {useParams} from 'react-router';
import {catalogParams, catalogQuerySchema} from '../../supabase/functions/_shared/contracts.ts';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState, Loading, NotFound} from '../components/Status.tsx';
import {AddToCart, Availability, ItemCard, Price, ProductImage, QtyStepper, itemHref} from '../components/ui.tsx';
import {getItem} from '../lib/api.ts';
import {useMeta} from '../lib/browser.ts';
import {useMatchMedia} from '../lib/motion.ts';
import {formatUah} from '../lib/format.ts';
import {imageUrl} from '../lib/images.ts';
import type {FacetGroup, ItemCard as ItemCardT, ItemDetail} from '../lib/types.ts';

const stickyInfo: CSSProperties = {position: 'sticky', top: 'calc(var(--spacing-10) + var(--spacing-6))', alignSelf: 'start'};
const thumb: CSSProperties = {width: '100%', height: '100%', objectFit: 'cover', display: 'block'};
const preline: CSSProperties = {whiteSpace: 'pre-line'};
const plainList: CSSProperties = {listStyle: 'none', margin: 0, padding: 0};

const GROUP_TITLE: Record<FacetGroup, string> = {
  skin_type: 'Тип шкіри',
  skin_need: 'Потреби шкіри',
  kit_purpose: 'Призначення',
  age_product: 'Вік',
  age_kit: 'Вік',
  season: 'Сезон',
};

function Gallery({item}: {item: ItemDetail}) {
  const [i, setI] = useState(0);
  const imgs = item.images;
  return (
    <VStack gap={3}>
      <Card padding={0}>
        <ProductImage path={imgs[i]?.path ?? null} alt={imgs[i]?.alt || item.name} eager />
      </Card>
      {imgs.length > 1 && (
        <Grid columns={5} gap={2}>
          {imgs.map((im, n) => (
            <AspectRatio key={im.path} ratio={1}>
              <SelectableCard label={`Фото ${n + 1}`} isSelected={i === n} onChange={() => setI(n)} variant="transparent" padding={0} width="100%" height="100%">
                <img src={imageUrl(im.path)!} alt="" style={thumb} loading="lazy" />
              </SelectableCard>
            </AspectRatio>
          ))}
        </Grid>
      )}
    </VStack>
  );
}

function Properties({item}: {item: ItemDetail}) {
  // the page shows skin needs, then skin types (owner's layout); age and purpose stay as catalog filters
  const order: FacetGroup[] = ['skin_need', 'skin_type'];
  const groups = new Map<FacetGroup, ItemDetail['facets']>();
  for (const g of order) {
    const fs = item.facets.filter(f => f.group === g);
    if (fs.length) groups.set(g, fs);
  }
  if (!groups.size) return null;
  return (
    <VStack gap={3}>
      {[...groups].map(([g, fs]) => (
        <VStack key={g} gap={1.5}>
          <Text type="label">{GROUP_TITLE[g]}</Text>
          <HStack gap={1.5} wrap="wrap">
            {fs.map(f => {
              const key = g === 'skin_type' ? 'skin' : g === 'skin_need' ? 'need' : g === 'kit_purpose' ? 'purpose' : g === 'season' ? 'season' : 'age';
              return <Token key={f.slug} label={f.label} href={`/katalog?${catalogParams(catalogQuerySchema.parse({[key]: [f.slug]}))}`} />;
            })}
          </HStack>
        </VStack>
      ))}
    </VStack>
  );
}

/** Kit price as the owner designed it: separate sum struck through, −15 %, kit price, the saving. */
function KitPrice({item}: {item: ItemDetail}) {
  const base = item.base_kop ?? item.price_kop;
  const saving = base - item.price_kop;
  return (
    <VStack gap={2}>
      {saving > 0 && (
        <HStack gap={2} vAlign="center">
          <Text type="large" color="secondary" hasStrikethrough>
            {formatUah(base)}
          </Text>
          <Badge variant="success" label={`−${item.discount_bp / 100}%`} />
        </HStack>
      )}
      <Text type="display-3" weight="bold">
        {formatUah(item.price_kop)}
      </Text>
      {saving > 0 && (
        <HStack gap={1.5} vAlign="center">
          <Icon icon={Tag} color="accent" />
          <Text type="body" color="accent" weight="semibold">
            Ваша економія — {formatUah(saving)}
          </Text>
        </HStack>
      )}
      <Text type="supporting" color="secondary">
        Купувати засоби в наборі вигідніше, ніж окремо.
      </Text>
    </VStack>
  );
}

/** «Що входить до набору»: each product links to its own page. */
function KitContents({item}: {item: ItemDetail}) {
  return (
    <VStack gap={4} as="ol" aria-label="Що входить до набору" style={plainList}>
      {(item.components ?? []).map((c, n) => {
        const title = `${n + 1}. ${c.name}${c.volume ? ` — ${c.volume}` : ''}${c.qty > 1 ? ` × ${c.qty}` : ''}`;
        return (
          <VStack key={c.id} as="li" gap={1}>
            {c.is_public ? (
              <Link href={`/tovar/${c.slug}`} label={title} hasUnderline weight="semibold">
                {title}
              </Link>
            ) : (
              <Text type="body" weight="semibold">
                {title}
              </Text>
            )}
            {c.note && (
              <Text type="body" color="secondary" style={preline}>
                {c.note}
              </Text>
            )}
            <Text type="supporting" color="secondary">
              Вартість окремо: {formatUah(c.price_kop * c.qty)}
            </Text>
          </VStack>
        );
      })}
    </VStack>
  );
}

/** «Доповніть свій догляд»: products the owner recommends with this item (owner's mock-up). */
function Recommendations({items}: {items: ItemCardT[]}) {
  return (
    <VStack gap={4}>
      <Heading level={2}>Доповніть свій догляд</Heading>
      <Card padding={4}>
        <VStack gap={3}>
          {items.map((r, n) => (
            <VStack key={r.id} gap={3}>
              {n > 0 && <Divider />}
              <HStack gap={3} vAlign="center" hAlign="between">
                <StackItem size="fill">
                  <VStack gap={0.5}>
                    <Link href={itemHref(r)} label={r.name} color="primary" weight="semibold">
                      {r.name}
                    </Link>
                    {r.short_purpose && (
                      <Text type="supporting" color="secondary">
                        {r.short_purpose}
                      </Text>
                    )}
                    <Text type="body" weight="semibold">
                      {[r.volume, formatUah(r.price_kop)].filter(Boolean).join(' · ')}
                    </Text>
                  </VStack>
                </StackItem>
                <AddToCart item={r} isIconOnly />
              </HStack>
            </VStack>
          ))}
        </VStack>
      </Card>
    </VStack>
  );
}

export default function ItemPage({kind}: {kind: 'product' | 'kit'}) {
  const {slug = ''} = useParams();
  const q = useQuery({queryKey: ['item', slug], queryFn: () => getItem(slug)});
  const [qty, setQty] = useState(1);
  // two columns only on wide screens; sticking a tall column on a phone froze scrolling
  const twoCols = useMatchMedia('(min-width: 960px)');
  const item = q.data;
  const isKit = item?.kind === 'kit';
  const sections: [string, React.ReactNode][] = !item
    ? []
    : isKit
      ? [
          ['Опис набору', item.description],
          ['Що входить до набору', item.components?.length ? <KitContents item={item} /> : null],
          ['Очікуваний результат', item.expected_result],
          ['Схема догляду', item.usage],
          ['Застереження', item.warnings],
        ]
      : [
          ['Опис', item.description],
          ['Склад (INCI)', item.inci],
          ['Спосіб застосування', item.usage],
          ['Застереження', item.warnings],
        ];
  const shown = sections.filter(([, v]) => (typeof v === 'string' ? !!v.trim() : !!v));
  const recs = item?.recommendations ?? [];

  useMeta({
    title: item?.name ?? 'Товар',
    description: item ? `${item.name}${item.volume ? `, ${item.volume}` : ''} — ${formatUah(item.price_kop)}. ${item.short_purpose ?? item.description?.slice(0, 120) ?? 'Green Touch'}` : undefined,
    path: item ? itemHref(item) : undefined,
    image: imageUrl(item?.images[0]?.path),
    jsonLd: item && {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: item.name,
      brand: {'@type': 'Brand', name: 'Green Touch'},
      ...(item.images.length ? {image: item.images.map(i => imageUrl(i.path))} : {}),
      ...(item.description ? {description: item.description} : {}),
      ...(item.volume ? {size: item.volume} : {}),
      offers: {
        '@type': 'Offer',
        priceCurrency: 'UAH',
        price: (item.price_kop / 100).toFixed(2),
        availability: item.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: typeof location !== 'undefined' ? location.origin + itemHref(item) : undefined,
      },
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!item || (kind === 'kit') !== (item.kind === 'kit')) return <NotFound />;

  return (
    <Page>
      {/* no product name here: it is the heading right below, and a long name wrapped
          onto a new line that started with the «/» separator */}
      <Breadcrumbs label="Навігація">
        <BreadcrumbItem href="/">Головна</BreadcrumbItem>
        <BreadcrumbItem href={`/katalog?kategoriia=${item.category}`}>{item.category_name}</BreadcrumbItem>
      </Breadcrumbs>
      <Grid columns={{minWidth: 320, repeat: 'fit'}} gap={8}>
        <Gallery item={item} />
        <VStack gap={5} style={twoCols ? stickyInfo : undefined}>
          <VStack gap={2}>
            <Text type="display-3" as="h1">
              {item.name}
            </Text>
            {!isKit && item.volume && (
              <Text type="body" color="secondary">
                {item.volume}
              </Text>
            )}
            {item.short_purpose && (
              <Text type={isKit ? 'body' : 'large'} color={isKit ? 'secondary' : undefined}>
                {item.short_purpose}
              </Text>
            )}
            {isKit ? <KitPrice item={item} /> : <Price price={item.price_kop} base={item.base_kop} discountBp={item.discount_bp} size="lg" />}
            <Availability available={item.available} />
          </VStack>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <QtyStepper value={qty} onChange={setQty} label={item.name} />
            <AddToCart item={item} qty={qty} size="lg" />
          </HStack>
          {isKit && <Divider />}
          <Properties item={item} />
          {shown.length > 0 && (
            <CollapsibleGroup type="multiple" defaultValue={isKit ? shown.slice(0, 2).map(([t]) => t) : [shown[0]![0]]}>
              {shown.map(([title, body]) => (
                <Collapsible key={title} value={title} trigger={<Heading level={3}>{title}</Heading>}>
                  {typeof body === 'string' ? (
                    <Text type="body" style={preline}>
                      {body}
                    </Text>
                  ) : (
                    body
                  )}
                </Collapsible>
              ))}
            </CollapsibleGroup>
          )}
          <Banner
            status="info"
            title="Під замовлення · доставка й оплата"
            description="Виготовляємо й відправляємо за 1–3 робочі дні після оплати. Нова пошта: відділення або поштомат, доставку сплачує отримувач за тарифами перевізника. Повна оплата онлайн через monobank або передоплата 150 грн."
            collapsible={false}
          />
          {item.in_kits.length > 0 && (
            <VStack gap={1.5}>
              <Text type="label">Входить до наборів</Text>
              {item.in_kits.map(k => (
                <Link key={k.slug} href={`/nabir/${k.slug}`} label={`${k.name} — ${formatUah(k.price_kop)}`}>{`${k.name} — ${formatUah(k.price_kop)}`}</Link>
              ))}
            </VStack>
          )}
        </VStack>
      </Grid>
      {recs.length > 0 ? (
        <Recommendations items={recs} />
      ) : (
        item.related.length > 0 && (
          <VStack gap={4}>
            <Heading level={2}>Схожі товари</Heading>
            <Grid columns={{minWidth: 200}} gap={5} align="stretch">
              {item.related.map(r => (
                <ItemCard key={r.id} item={r} />
              ))}
            </Grid>
          </VStack>
        )
      )}
      {shown.length === 0 && item.facets.length === 0 && (
        <Button label="До каталогу" variant="ghost" href="/katalog" />
      )}
    </Page>
  );
}
