import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {LinkProvider} from '@astryxdesign/core/Link';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {ArrowSquareOut, CalendarDots, ChatCircleDots, Coins, GearSix, SignOut, Ticket, Warehouse} from '@phosphor-icons/react';
import {useMatchMedia} from '../../lib/motion.ts';
import {BottomNav, BOTTOM_NAV_SPACE} from '../../components/BottomNav.tsx';
import type {Session} from '@supabase/supabase-js';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Navigate, Outlet, ScrollRestoration, useLocation, useNavigate} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {RouterLink} from '../../components/RouterLink.tsx';
import {FullScreenError, FullScreenLoading} from '../../components/StatusScreens.tsx';
import {OwnerApi} from '../../lib/api/owner.ts';
import {clearPrivateCaches} from '../../lib/pwa.ts';
import {ownerClient} from '../../lib/supabase.ts';
import {OwnerContext, ownerKey} from './ownerContext.tsx';
import {PageContainer} from '../../components/layout/Page.tsx';
import {msg} from '../../i18n/index.ts';
import {tireMsg} from '../../i18n/tire.ts';
import {washMsg} from '../../i18n/wash.ts';

export default function OwnerRoot() {
  const tenant = useTenant();
  const client = ownerClient(tenant.slug);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const main = useRef<HTMLElement | null>(null);
  const wide = useMatchMedia('(min-width: 720px)');

  useEffect(() => {
    void client.auth.getSession().then(({data}) => setSession(data.session));
    const {data} = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    main.current?.focus({preventScroll: true});
  }, [pathname]);

  const api = useMemo(() => new OwnerApi(client, tenant.id), [client, tenant.id]);

  // Membership is decided by the server: RLS returns the studio row only to its members.
  const member = useQuery({
    queryKey: ownerKey(tenant.slug, 'membership', session?.user.id),
    queryFn: () => api.tenantRow(),
    enabled: !!session,
  });

  const logout = useCallback(async () => {
    await client.auth.signOut();
    qc.removeQueries({queryKey: ['owner']});
    await clearPrivateCaches(tenant.slug);
    navigate(`/s/${tenant.slug}/owner/login`, {replace: true});
  }, [client, qc, navigate, tenant.slug]);

  if (session === undefined || (session && member.isPending)) return <FullScreenLoading />;
  if (!session) return <Navigate to={`/s/${tenant.slug}/owner/login`} replace />;
  if (member.isError) return <FullScreenError title={msg.owner.cannotOpen} description={member.error.message} onRetry={() => void member.refetch()} />;
  if (!member.data) {
    return (
      <FullScreenError
        title={msg.owner.noAccess}
        description={msg.owner.noAccessHint}
        onRetry={() => void logout()}
      />
    );
  }

  const base = `/s/${tenant.slug}/owner`;
  const sections = [
    {value: 'bookings', label: msg.owner.tabs.bookings, to: base, icon: CalendarDots},
    // Tyre services: the tyre hotel sits next to the bookings.
    ...(tenant.tire ? [{value: 'tires', label: tireMsg().owner.tab, to: `${base}/tires`, icon: Warehouse}] : []),
    // Car washes: passes («N washes»).
    ...(tenant.wash ? [{value: 'passes', label: washMsg().passes.tab, to: `${base}/passes`, icon: Ticket}] : []),
    {value: 'stats', label: msg.owner.tabs.stats, to: `${base}/stats`, icon: Coins},
    {value: 'settings', label: msg.owner.tabs.settings, to: `${base}/settings`, icon: GearSix},
    {value: 'assistant', label: msg.owner.tabs.assistant, to: `${base}/assistant`, icon: ChatCircleDots},
  ];
  const tab = pathname.replace(base, '').replace(/^\//, '').split('/')[0] || 'bookings';

  return (
    <OwnerContext.Provider value={{api, session, slug: tenant.slug, logout}}>
      <LinkProvider component={RouterLink}>
        <ScrollRestoration />
        <VStack minHeight="100dvh" style={{paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'}}>
          {/* Full-width sticky bar; its content sits on the same column as the page below. */}
          <VStack
            as="header"
            style={{position: 'sticky', top: 0, zIndex: 20, background: 'var(--color-background-body)', borderBottom: '1px solid var(--color-border)'}}
          >
            <PageContainer style={{gap: 'var(--spacing-2)', paddingBlockStart: 'var(--spacing-3)'}}>
              <HStack justify="between" align="center" gap={2}>
                <VStack gap={0} style={{minWidth: 0}}>
                  <Text type="supporting">{msg.owner.cabinet}</Text>
                  <Text weight="bold" maxLines={1}>
                    {tenant.name}
                  </Text>
                </VStack>
                <HStack gap={1} style={{flexShrink: 0}}>
                  <Button label={msg.owner.openSite} variant="ghost" size="sm" isIconOnly icon={<Icon icon={ArrowSquareOut} />} href={`/s/${tenant.slug}/`} target="_blank" tooltip={msg.owner.siteTip} />
                  <Button label={msg.owner.logout} variant="ghost" size="sm" icon={<Icon icon={SignOut} />} onClick={() => void logout()} />
                </HStack>
              </HStack>
              {/* Wide screens: tabs in the header. Phones: the same four sections in a bottom bar. */}
              {wide ? (
                <TabList value={tab} onChange={v => navigate(v === 'bookings' ? base : `${base}/${v}`)} size="md">
                  {sections.map(s => (
                    <Tab key={s.value} value={s.value} label={s.label} href={s.to} />
                  ))}
                </TabList>
              ) : (
                <VStack style={{height: 'var(--spacing-1)'}} aria-hidden="true" />
              )}
            </PageContainer>
          </VStack>
          <PageContainer as="main" ref={main} style={{outline: 'none', paddingBlockEnd: wide ? 'var(--spacing-8)' : BOTTOM_NAV_SPACE}}>
            <Outlet />
          </PageContainer>
          {!wide && <BottomNav label={msg.owner.navLabel} items={sections.map(s => ({to: s.to, label: s.label, icon: s.icon, end: s.value === 'bookings'}))} />}
        </VStack>
      </LinkProvider>
    </OwnerContext.Provider>
  );
}
