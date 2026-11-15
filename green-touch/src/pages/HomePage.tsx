import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Heading, Text} from '@astryxdesign/core/Text';
import {ArrowRight, CreditCard, Package, Truck} from '@phosphor-icons/react';
import {useQuery} from '@tanstack/react-query';
import {CONCERNS, catalogParams, catalogQuerySchema} from '../../supabase/functions/_shared/contracts.ts';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState, Loading} from '../components/Status.tsx';
import {ItemCard, ProductImage} from '../components/ui.tsx';
import {getMeta} from '../lib/api.ts';
import {useMeta} from '../lib/browser.ts';
import {useReveal} from '../lib/motion.ts';
import type {ReactNode} from 'react';

const catalogLink = (o: Partial<{category: string; need: string[]}>) => `/katalog?${catalogParams(catalogQuerySchema.parse({...o}))}`;

function Reveal({children}: {children: ReactNode}) {
  const {ref, style} = useReveal<HTMLElement>();
  return (
    <section ref={ref} style={style}>
      {children}
    </section>
  );
}

function SectionHead({title, action}: {title: string; action?: ReactNode}) {
  return (
    <HStack gap={3} vAlign="end" hAlign="between" wrap="wrap">
      <Heading level={2}>{title}</Heading>
      {action}
    </HStack>
  );
}

export default function HomePage() {
  const meta = useQuery({queryKey: ['meta'], queryFn: getMeta, staleTime: 5 * 60_000});
  const brand = meta.data?.settings.brand ?? {};
  useMeta({
    title: 'Green Touch',
    description: brand.tagline ? `${brand.tagline}. Креми, сироватки, тоніки, очищення й маски. Доставка Новою поштою.` : 'Косметика Green Touch',
    path: '/',
    jsonLd: {'@context': 'https://schema.org', '@type': 'Organization', name: 'Green Touch', url: typeof location !== 'undefined' ? location.origin : undefined},
  });
  if (meta.isPending) return <Loading />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  const m = meta.data;
  const categories = m.categories.filter(c => c.count > 0);
  const needCounts = new Map(m.facets.filter(f => f.group === 'skin_need').map(f => [f.slug, f.count ?? 0]));
  const concerns = CONCERNS.filter(c => (needCounts.get(c.need) ?? 0) > 0);
  const contacts = m.settings.contacts ?? {};

  return (
    <Page>
      {/* 1. First screen */}
      <Grid columns={brand.hero_photo ? {minWidth: 300} : 1} gap={6} align="center">
        <VStack gap={4} hAlign="start" maxWidth={720}>
          <Text type="supporting" color="accent" weight="semibold">
            Косметика власного виробництва
          </Text>
          <Text type="display-1" as="h1">
            Green Touch
          </Text>
          <Text type="large" color="secondary">
            {brand.tagline}
          </Text>
          {brand.hero_text && <Text type="body">{brand.hero_text}</Text>}
          <Button label="Переглянути каталог" variant="primary" size="lg" href="/katalog" endContent={<Icon icon={ArrowRight} color="inherit" />} />
        </VStack>
        {brand.hero_photo && (
          <Card padding={0}>
            <ProductImage path={brand.hero_photo} alt="Green Touch" ratio={4 / 3} eager />
          </Card>
        )}
      </Grid>

      {/* 2. Categories */}
      {categories.length > 0 && (
        <Reveal>
          <VStack gap={4}>
            <SectionHead title="Категорії" action={<Link href="/katalog" label="Усі товари">Усі товари</Link>} />
            <Grid columns={{minWidth: 150}} gap={3}>
              {categories.map(c => (
                <ClickableCard key={c.slug} label={c.name} href={catalogLink({category: c.slug})} padding={4}>
                  <VStack gap={1}>
                    <Text type="large" weight="semibold">
                      {c.name}
                    </Text>
                    <Text type="supporting" color="secondary">
                      {c.count} {c.count === 1 ? 'позиція' : c.count < 5 ? 'позиції' : 'позицій'}
                    </Text>
                  </VStack>
                </ClickableCard>
              ))}
            </Grid>
          </VStack>
        </Reveal>
      )}

      {/* 3. Owner's picks */}
      {m.home_picks.length > 0 && (
        <Reveal>
          <VStack gap={4}>
            <SectionHead title="Обране" action={<Link href="/katalog" label="До каталогу">До каталогу</Link>} />
            <Grid columns={{minWidth: 220}} gap={5} align="stretch">
              {m.home_picks.slice(0, 8).map(i => (
                <ItemCard key={i.id} item={i} />
              ))}
            </Grid>
          </VStack>
        </Reveal>
      )}

      {/* 4. About the cosmetologist and the brand */}
      <Reveal>
        <Card padding={6} variant="muted">
          <Grid columns={{minWidth: 280}} gap={6} align="center">
            <Card padding={0}>
              <ProductImage path={brand.cosmetologist_photo} alt={brand.cosmetologist_name ?? 'Косметолог Green Touch'} ratio={1} />
            </Card>
            <VStack gap={3} hAlign="start">
              <Heading level={2}>{brand.about_title ?? 'Про косметолога та бренд'}</Heading>
              {brand.cosmetologist_name && <Text type="large">{brand.cosmetologist_name}</Text>}
              <Text type="body" color="secondary">
                {brand.about_text ?? 'Green Touch — косметика власного виробництва, створена косметологом.'}
              </Text>
              <Button label="Детальніше про бренд" href="/pro-brend" />
            </VStack>
          </Grid>
        </Card>
      </Reveal>

      {/* 5. «Що турбує вашу шкіру?» — only needs that already have confirmed items */}
      {concerns.length > 0 && (
        <Reveal>
          <VStack gap={4}>
            <SectionHead title="Що турбує вашу шкіру?" />
            <HStack gap={2} wrap="wrap">
              {concerns.map(c => (
                <Button key={c.need} label={c.label} href={catalogLink({need: [c.need]})} />
              ))}
            </HStack>
            <Text type="supporting" color="secondary">
              Добірки за характеристиками, які підтвердила косметолог. Це не діагноз і не призначення лікування.
            </Text>
          </VStack>
        </Reveal>
      )}

      {/* 6. Care kits (only if published) */}
      {m.kits.length > 0 && (
        <Reveal>
          <VStack gap={4}>
            <SectionHead title="Набори догляду" action={<Link href={catalogLink({category: 'nabory'})} label="Усі набори">Усі набори</Link>} />
            <Grid columns={{minWidth: 220}} gap={5} align="stretch">
              {m.kits.slice(0, 4).map(i => (
                <ItemCard key={i.id} item={i} />
              ))}
            </Grid>
          </VStack>
        </Reveal>
      )}

      {/* 7. Delivery and payment */}
      <Reveal>
        <VStack gap={4}>
          <SectionHead title="Доставка й оплата" action={<Link href="/dostavka-i-oplata" label="Детальніше">Детальніше</Link>} />
          <Grid columns={{minWidth: 240}} gap={4}>
            <Card padding={5}>
              <VStack gap={2}>
                <Icon icon={Truck} color="accent" size="lg" />
                <Text type="large" weight="semibold">
                  Нова пошта
                </Text>
                <Text type="body" color="secondary">
                  У відділення або поштомат. Вартість доставки сплачує отримувач за тарифами перевізника.
                </Text>
              </VStack>
            </Card>
            <Card padding={5}>
              <VStack gap={2}>
                <Icon icon={CreditCard} color="accent" size="lg" />
                <Text type="large" weight="semibold">
                  Оплата онлайн
                </Text>
                <Text type="body" color="secondary">
                  Карткою через LiqPay. Статус оплати підтверджує платіжний сервіс.
                </Text>
              </VStack>
            </Card>
            <Card padding={5}>
              <VStack gap={2}>
                <Icon icon={Package} color="accent" size="lg" />
                <Text type="large" weight="semibold">
                  Під замовлення
                </Text>
                <Text type="body" color="secondary">
                  Кожен засіб виготовляється після оплати замовлення. Реєстрація не потрібна.
                </Text>
              </VStack>
            </Card>
          </Grid>
        </VStack>
      </Reveal>

      {/* 8. Contacts */}
      <Reveal>
        <VStack gap={3}>
          <SectionHead title="Контакти" />
          {contacts.phone || contacts.email || contacts.instagram || contacts.telegram ? (
            <HStack gap={4} wrap="wrap">
              {contacts.phone && <Link href={`tel:${contacts.phone}`} label={contacts.phone}>{contacts.phone}</Link>}
              {contacts.email && <Link href={`mailto:${contacts.email}`} label={contacts.email}>{contacts.email}</Link>}
              {contacts.instagram && <Link href={contacts.instagram} label="Instagram" isExternalLink>Instagram</Link>}
              {contacts.telegram && <Link href={contacts.telegram} label="Telegram" isExternalLink>Telegram</Link>}
            </HStack>
          ) : (
            <Link href="/kontakty" label="Сторінка контактів">Сторінка контактів</Link>
          )}
        </VStack>
      </Reveal>
    </Page>
  );
}
