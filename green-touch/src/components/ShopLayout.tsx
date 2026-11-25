import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, Layout, LayoutContent, StackItem, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Text} from '@astryxdesign/core/Text';
import {List, Leaf, ShoppingBag} from '@phosphor-icons/react';
import {useQuery} from '@tanstack/react-query';
import {Suspense, useEffect, useState, type CSSProperties} from 'react';
import {Outlet, useLocation} from 'react-router';
import {getMeta} from '../lib/api.ts';
import {useOnline} from '../lib/browser.ts';
import {cartCount, useCart} from '../lib/cart.ts';
import {formatUah} from '../lib/format.ts';
import {useMatchMedia} from '../lib/motion.ts';
import {useAppUpdate} from '../lib/pwa.ts';
import {Loading} from './Status.tsx';

const NAV = [
  {href: '/katalog', label: 'Каталог'},
  {href: '/katalog?kategoriia=nabory', label: 'Набори'},
  {href: '/pro-brend', label: 'Наша історія'},
  {href: '/dostavka-i-oplata', label: 'Доставка й оплата'},
  {href: '/kontakty', label: 'Контакти'},
];

// Header stays on screen while scrolling (no sticky prop on Astryx layout primitives).
const sticky = {position: 'sticky', top: 0, zIndex: 20, viewTransitionName: 'gt-header', background: 'var(--color-background-body)', borderBlockEnd: '1px solid var(--color-border)'} as CSSProperties;
// Floating cart bar: a solid, opaque surface so the page under it never shows through the text.
const barWrap = {
  viewTransitionName: 'gt-cartbar',
  position: 'fixed',
  insetInline: 'var(--spacing-3)',
  bottom: 'calc(var(--spacing-3) + env(safe-area-inset-bottom))',
  zIndex: 30,
  maxWidth: 720,
  marginInline: 'auto',
  borderRadius: 'var(--radius-container)',
  background: 'var(--color-background-surface)',
  boxShadow: '0 8px 30px var(--color-shadow)',
  border: '1px solid var(--color-border)',
} as CSSProperties;

function CartBar() {
  const cart = useCart();
  const loc = useLocation();
  const hidden = cart.lines.length === 0 || /^\/(koshyk|oformlennia|admin)/.test(loc.pathname);
  if (hidden) return null;
  const total = cart.lines.reduce((s, l) => s + l.price_kop * l.qty, 0);
  return (
    <aside style={barWrap} aria-label="Кошик">
      <HStack gap={3} vAlign="center" hAlign="between" padding={3}>
        <StackItem size="fill">
          <VStack gap={0}>
            <Text type="label">У кошику: {cartCount(cart)}</Text>
            <Text type="supporting" color="secondary">
              ≈ {formatUah(total)}
            </Text>
          </VStack>
        </StackItem>
        <Button label="До кошика" variant="primary" href="/koshyk" icon={<Icon icon={ShoppingBag} color="inherit" />} />
      </HStack>
    </aside>
  );
}

function Header() {
  const cart = useCart();
  const wide = useMatchMedia('(min-width: 960px)');
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname, loc.search]);
  const n = cartCount(cart);
  return (
    <header style={sticky}>
      <HStack gap={4} vAlign="center" hAlign="between" paddingInline={4} paddingBlock={3} maxWidth={1240} style={{marginInline: 'auto'}}>
        <Link href="/" label="Green Touch — на головну" color="primary">
          <HStack gap={1.5} vAlign="center">
            <Icon icon={Leaf} color="accent" />
            <Text type="large" weight="bold">
              Green Touch
            </Text>
          </HStack>
        </Link>
        {wide && (
          <nav aria-label="Основна навігація">
            <HStack gap={5}>
              {NAV.map(i => (
                <Link key={i.href} href={i.href} label={i.label} color="primary">
                  {i.label}
                </Link>
              ))}
            </HStack>
          </nav>
        )}
        <HStack gap={1} vAlign="center">
          <Button label="Кошик" aria-label={n ? `Кошик, товарів: ${n}` : 'Кошик'} variant="ghost" href="/koshyk" icon={<Icon icon={ShoppingBag} />} endContent={n ? <Text type="label">{n}</Text> : undefined} />
          {!wide && <Button label="Меню" variant="ghost" isIconOnly icon={<Icon icon={List} />} onClick={() => setMenu(true)} />}
        </HStack>
      </HStack>
      <BottomSheet isOpen={menu} onOpenChange={setMenu} label="Меню" height="hug">
        <nav aria-label="Меню">
          <VStack gap={2} padding={3}>
            {NAV.map(i => (
              <Button key={i.href} label={i.label} variant="secondary" size="lg" href={i.href} width="100%" />
            ))}
          </VStack>
        </nav>
      </BottomSheet>
    </header>
  );
}

function Footer() {
  const meta = useQuery({queryKey: ['meta'], queryFn: getMeta, staleTime: 5 * 60_000});
  const c = meta.data?.settings.contacts ?? {};
  const legal = meta.data?.settings.legal;
  return (
    <footer style={{background: 'var(--color-background-muted)', marginBlockStart: 'var(--spacing-10)'}}>
      <VStack gap={5} paddingInline={4} paddingBlock={8} maxWidth={1240} style={{marginInline: 'auto'}}>
        <Grid columns={{minWidth: 220}} gap={6}>
          <VStack gap={2}>
            <Text type="large" weight="bold">
              Green Touch
            </Text>
            <Text type="body" color="secondary">
              {meta.data?.settings.brand?.tagline ?? 'Косметика власного виробництва'}
            </Text>
          </VStack>
          <VStack gap={1.5}>
            <Text type="label">Покупцям</Text>
            <Link href="/katalog" label="Каталог">Каталог</Link>
            <Link href="/dostavka-i-oplata" label="Доставка й оплата">Доставка й оплата</Link>
            <Link href="/umovy-pokupky" label="Умови покупки та повернення">Умови покупки та повернення</Link>
            <Link href="/polityka-konfidentsiinosti" label="Політика конфіденційності">Політика конфіденційності</Link>
          </VStack>
          <VStack gap={1.5}>
            <Text type="label">Контакти</Text>
            {c.phone && <Link href={`tel:${c.phone}`} label={c.phone}>{c.phone}</Link>}
            {c.email && <Link href={`mailto:${c.email}`} label={c.email}>{c.email}</Link>}
            {c.instagram && <Link href={c.instagram} label="Instagram" isExternalLink>Instagram</Link>}
            {c.telegram && <Link href={c.telegram} label="Telegram" isExternalLink>Telegram</Link>}
            {!c.phone && !c.email && <Link href="/kontakty" label="Сторінка контактів">Сторінка контактів</Link>}
          </VStack>
        </Grid>
        <Divider />
        <VStack gap={1}>
          {/* seller details must be visible on the site (Law of Ukraine «On e-commerce») */}
          {legal?.seller_name && (
            <Text type="supporting" color="secondary">
              Продавець: {[legal.seller_name, legal.seller_code && `РНОКПП ${legal.seller_code}`, legal.seller_address].filter(Boolean).join(' · ')}
            </Text>
          )}
          <Text type="supporting" color="secondary">
            © {new Date().getFullYear()} Green Touch. Ціни в гривнях. Доставку Новою поштою сплачує отримувач за тарифами перевізника.
          </Text>
        </VStack>
      </VStack>
    </footer>
  );
}

function UpdatePrompt() {
  const {needRefresh, update} = useAppUpdate();
  if (!needRefresh) return null;
  return (
    <Banner
      status="info"
      title="Доступна нова версія магазину"
      description="Дані форми й кошик збережуться після оновлення."
      collapsible={false}
      endContent={<Button label="Оновити" size="sm" onClick={update} />}
    />
  );
}

function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <Banner
      status="warning"
      title="Немає зʼєднання з інтернетом"
      description="Можна переглядати збережені сторінки й змінювати кошик. Ціни та наявність буде перевірено після підключення; оформлення й оплата зараз недоступні."
      collapsible={false}
    />
  );
}

export function ShopLayout() {
  return (
    <Layout
      height="auto"
      header={<Header />}
      content={
        <LayoutContent padding={0}>
          <UpdatePrompt />
          <OfflineNotice />
          <main id="main">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </main>
          <Footer />
          <CartBar />
        </LayoutContent>
      }
    />
  );
}

/** Page frame: centred column, comfortable gutters on phones. */
export function Page({children, width = 1240}: {children: React.ReactNode; width?: number}) {
  return (
    <VStack gap={8} paddingInline={4} paddingBlock={6} maxWidth={width} style={{marginInline: 'auto', width: '100%'}}>
      {children}
    </VStack>
  );
}
