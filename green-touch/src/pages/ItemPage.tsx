import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Banner} from '@astryxdesign/core/Banner';
import {Breadcrumbs, BreadcrumbItem} from '@astryxdesign/core/Breadcrumbs';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Collapsible, CollapsibleGroup} from '@astryxdesign/core/Collapsible';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {SelectableCard} from '@astryxdesign/core/SelectableCard';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {useQuery} from '@tanstack/react-query';
import {useState, type CSSProperties} from 'react';
import {useParams} from 'react-router';
import {catalogParams, catalogQuerySchema} from '../../supabase/functions/_shared/contracts.ts';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState, Loading, NotFound} from '../components/Status.tsx';
import {AddToCart, Availability, ItemCard, Price, ProductImage, QtyStepper, itemHref} from '../components/ui.tsx';
import {getItem} from '../lib/api.ts';
import {useMeta} from '../lib/browser.ts';
import {formatUah} from '../lib/format.ts';
import {imageUrl} from '../lib/images.ts';
import type {FacetGroup, ItemDetail} from '../lib/types.ts';

const stickyInfo: CSSProperties = {position: 'sticky', top: 'calc(var(--spacing-10) + var(--spacing-6))', alignSelf: 'start'};
const thumb: CSSProperties = {width: '100%', height: '100%', objectFit: 'cover', display: 'block'};
const preline: CSSProperties = {whiteSpace: 'pre-line'};

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
  const groups = new Map<FacetGroup, ItemDetail['facets']>();
  for (const f of item.facets) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
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

function KitComposition({item}: {item: ItemDetail}) {
  if (!item.components?.length) return null;
  return (
    <Card padding={4} variant="muted">
      <VStack gap={3}>
        <Heading level={3}>Склад набору</Heading>
        <VStack gap={2} as="ul" aria-label="Склад набору">
          {item.components.map(c => (
            <HStack key={c.id} as="li" gap={3} hAlign="between" vAlign="center">
              <VStack gap={0}>
                {c.is_public ? <Link href={`/tovar/${c.slug}`} label={c.name}>{c.name}</Link> : <Text type="body">{c.name}</Text>}
                <Text type="supporting" color="secondary">
                  {[c.volume, c.qty > 1 ? `× ${c.qty}` : null].filter(Boolean).join(' ')}
                </Text>
              </VStack>
              <Text type="body" color="secondary">
                {formatUah(c.price_kop * c.qty)}
              </Text>
            </HStack>
          ))}
        </VStack>
        <Divider />
        <HStack hAlign="between">
          <Text type="body">Окремо</Text>
          <Text type="body" hasStrikethrough color="secondary">
            {formatUah(item.base_kop ?? 0)}
          </Text>
        </HStack>
        <HStack hAlign="between">
          <Text type="body">Знижка набору −{item.discount_bp / 100}%</Text>
          <Text type="body">−{formatUah((item.base_kop ?? 0) - item.price_kop)}</Text>
        </HStack>
        <HStack hAlign="between">
          <Text type="label">Ціна набору</Text>
          <Text type="large" weight="bold">
            {formatUah(item.price_kop)}
          </Text>
        </HStack>
        <Text type="supporting" color="secondary">
          Набір додається в кошик однією позицією, склад змінити не можна.
        </Text>
      </VStack>
    </Card>
  );
}

export default function ItemPage({kind}: {kind: 'product' | 'kit'}) {
  const {slug = ''} = useParams();
  const q = useQuery({queryKey: ['item', slug], queryFn: () => getItem(slug)});
  const [qty, setQty] = useState(1);
  const item = q.data;
  const sections = item
    ? ([
        ['Опис', item.description],
        ['Склад (INCI)', item.inci],
        ['Спосіб застосування', item.usage],
        ['Застереження', item.warnings],
      ].filter(([, v]) => !!v?.trim()) as [string, string][])
    : [];

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
        <VStack gap={5} style={stickyInfo}>
          <VStack gap={2}>
            <Text type="display-3" as="h1">
              {item.name}
            </Text>
            {item.volume && (
              <Text type="body" color="secondary">
                {item.volume}
              </Text>
            )}
            {item.short_purpose && <Text type="large">{item.short_purpose}</Text>}
            <Price price={item.price_kop} base={item.base_kop} discountBp={item.discount_bp} size="lg" />
            <Availability available={item.available} />
          </VStack>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <QtyStepper value={qty} onChange={setQty} label={item.name} />
            <AddToCart item={item} qty={qty} size="lg" />
          </HStack>
          {item.kind === 'kit' && <KitComposition item={item} />}
          <Properties item={item} />
          {sections.length > 0 && (
            <CollapsibleGroup type="multiple" defaultValue={[sections[0]![0]]}>
              {sections.map(([title, body]) => (
                <Collapsible key={title} value={title} trigger={<Heading level={3}>{title}</Heading>}>
                  <Text type="body" style={preline}>
                    {body}
                  </Text>
                </Collapsible>
              ))}
            </CollapsibleGroup>
          )}
          <Banner
            status="info"
            title="Під замовлення · доставка й оплата"
            description="Виготовляється під замовлення після оплати. Нова пошта: відділення або поштомат, доставку сплачує отримувач за тарифами перевізника. Повна оплата онлайн через monobank або передоплата 150 грн."
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
      {item.related.length > 0 && (
        <VStack gap={4}>
          <Heading level={2}>Схожі товари</Heading>
          <Grid columns={{minWidth: 200}} gap={5} align="stretch">
            {item.related.map(r => (
              <ItemCard key={r.id} item={r} />
            ))}
          </Grid>
        </VStack>
      )}
      {sections.length === 0 && item.facets.length === 0 && (
        <Button label="До каталогу" variant="ghost" href="/katalog" />
      )}
    </Page>
  );
}
