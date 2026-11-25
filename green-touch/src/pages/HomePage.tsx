import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Heading, Text} from '@astryxdesign/core/Text';
import {ArrowRight, CheckCircle, CreditCard, DeviceMobile, Export, Package, PlusSquare, Truck} from '@phosphor-icons/react';
import {useQuery} from '@tanstack/react-query';
import {CONCERNS, catalogParams, catalogQuerySchema} from '../../supabase/functions/_shared/contracts.ts';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState, Loading} from '../components/Status.tsx';
import {ItemCard, ProductImage} from '../components/ui.tsx';
import {getMeta} from '../lib/api.ts';
import {useMeta} from '../lib/browser.ts';
import {useReveal} from '../lib/motion.ts';
import {useInstallApp} from '../lib/pwa.ts';
import {useState, type ReactNode} from 'react';

/** In-app browsers (Instagram, Facebook, Telegram, TikTok…) have no «На екран „Додому“» at all. */
const isInAppBrowser = () => typeof navigator !== 'undefined' && /Instagram|FBAN|FBAV|FB_IAB|Telegram|TikTok|Line\/|Viber|GSA\//i.test(navigator.userAgent);

function IosInstallSheet({open, onOpenChange}: {open: boolean; onOpenChange: (v: boolean) => void}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const inApp = isInAppBrowser();
  return (
    <BottomSheet isOpen={open} onOpenChange={onOpenChange} label="Як додати Green Touch на головний екран" height="hug" padding={5}>
      <VStack gap={4}>
        <Heading level={2}>Додати на головний екран</Heading>
        {inApp && (
          <Banner
            status="info"
            title="Ви у вбудованому браузері застосунку"
            description="Тут немає пункту «На екран „Додому“». Скопіюйте посилання й відкрийте його в Safari, а потім повторіть кроки нижче."
            collapsible={false}
          />
        )}
        <HStack gap={3} vAlign="center">
          <Icon icon={Export} size="lg" color="accent" />
          <Text type="body">1. Натисніть «Поділитися» — квадрат зі стрілкою вгору на панелі Safari (внизу екрана).</Text>
        </HStack>
        <HStack gap={3} vAlign="center">
          <Icon icon={PlusSquare} size="lg" color="accent" />
          <Text type="body">2. Прогорніть меню вниз і оберіть «На екран „Додому“».</Text>
        </HStack>
        <HStack gap={3} vAlign="center">
          <Icon icon={CheckCircle} size="lg" color="accent" />
          <Text type="body">3. Натисніть «Додати» — значок Green Touch зʼявиться поруч з іншими застосунками.</Text>
        </HStack>
        <Text type="supporting" color="secondary">
          Немає пункту «На екран „Додому“»? Відкрийте сайт саме в Safari: у Telegram, Instagram та інших застосунках його немає.
        </Text>
        <HStack gap={2} wrap="wrap">
          <Button label={copied ? 'Посилання скопійовано' : 'Скопіювати посилання'} variant={inApp ? 'primary' : 'secondary'} onClick={() => void copy()} />
          <Button label="Зрозуміло" variant={inApp ? 'secondary' : 'primary'} onClick={() => onOpenChange(false)} />
        </HStack>
      </VStack>
    </BottomSheet>
  );
}

function InstallCard() {
  const {hidden, platform, install} = useInstallApp();
  const [sheet, setSheet] = useState(false);
  if (hidden) return null;
  return (
    <Card padding={5} variant="green">
      <HStack gap={4} vAlign="start" wrap="wrap">
        <Icon icon={DeviceMobile} color="accent" size="lg" />
        <StackItem size="fill">
          <VStack gap={3}>
            <Heading level={2}>Green Touch на головному екрані</Heading>
            <Text type="body" color="secondary">
              Додайте магазин як застосунок: відкривається в один дотик, без адресного рядка, а збережений кошик і каталог доступні навіть без інтернету.
            </Text>
            {platform === 'other' ? (
              <Text type="body">Відкрийте меню браузера (⋮ або ⋯) і оберіть «Додати на головний екран» або «Встановити застосунок».</Text>
            ) : (
              <HStack gap={2}>
                <Button
                  label="Додати на головний екран"
                  variant="primary"
                  icon={<Icon icon={PlusSquare} />}
                  onClick={() => (platform === 'prompt' ? void install() : setSheet(true))}
                />
              </HStack>
            )}
          </VStack>
        </StackItem>
      </HStack>
      {platform === 'ios' && <IosInstallSheet open={sheet} onOpenChange={setSheet} />}
    </Card>
  );
}

const catalogLink =(o: Partial<{category: string; need: string[]}>) => `/katalog?${catalogParams(catalogQuerySchema.parse({...o}))}`;

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
              <Button label="Наша історія" href="/pro-brend" />
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
                  Повна оплата через monobank або передоплата 150 грн, решта — на Новій пошті.
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
                  Кожен засіб виготовляється після оплати й відправляється за 1–3 робочі дні. Реєстрація не потрібна.
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

      {/* 9. Add to home screen (hidden once installed) */}
      <InstallCard />
    </Page>
  );
}
