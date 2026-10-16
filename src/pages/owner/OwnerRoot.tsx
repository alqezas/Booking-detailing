import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {LinkProvider} from '@astryxdesign/core/Link';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {ArrowSquareOut, SignOut} from '@phosphor-icons/react';
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

export default function OwnerRoot() {
  const tenant = useTenant();
  const client = ownerClient(tenant.slug);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const main = useRef<HTMLElement | null>(null);

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
  if (member.isError) return <FullScreenError title="Не удалось открыть кабинет" description={member.error.message} onRetry={() => void member.refetch()} />;
  if (!member.data) {
    return (
      <FullScreenError
        title="Нет доступа к этой студии"
        description="Вы вошли под учётной записью, которая не связана с этой студией."
        onRetry={() => void logout()}
      />
    );
  }

  const base = `/s/${tenant.slug}/owner`;
  const tab = pathname.replace(base, '').replace(/^\//, '').split('/')[0] || 'bookings';

  return (
    <OwnerContext.Provider value={{api, session, slug: tenant.slug, logout}}>
      <LinkProvider component={RouterLink}>
        <ScrollRestoration />
        <VStack minHeight="100dvh" style={{paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'}}>
          <VStack
            as="header"
            gap={2}
            paddingInline={4}
            paddingBlockStart={3}
            style={{position: 'sticky', top: 0, zIndex: 20, background: 'var(--color-background-body)', borderBottom: '1px solid var(--color-border)'}}
          >
            <HStack justify="between" align="center" gap={2}>
              <VStack gap={0}>
                <Text type="supporting">Кабинет</Text>
                <Text weight="bold" maxLines={1}>
                  {tenant.name}
                </Text>
              </VStack>
              <HStack gap={1}>
                <Button label="Открыть сайт студии" variant="ghost" size="sm" isIconOnly icon={<Icon icon={ArrowSquareOut} />} href={`/s/${tenant.slug}/`} target="_blank" tooltip="Сайт студии" />
                <Button label="Выйти" variant="ghost" size="sm" icon={<Icon icon={SignOut} />} onClick={() => void logout()} />
              </HStack>
            </HStack>
            <TabList value={tab} onChange={v => navigate(v === 'bookings' ? base : `${base}/${v}`)} layout="fill" size="md">
              <Tab value="bookings" label="Записи" href={base} />
              <Tab value="stats" label="Деньги" href={`${base}/stats`} />
              <Tab value="settings" label="Настройки" href={`${base}/settings`} />
              <Tab value="assistant" label="Помощник" href={`${base}/assistant`} />
            </TabList>
          </VStack>
          <VStack as="main" ref={main} tabIndex={-1} aria-label="Кабинет" maxWidth={960} width="100%" style={{marginInline: 'auto', outline: 'none'}}>
            <Outlet />
          </VStack>
        </VStack>
      </LinkProvider>
    </OwnerContext.Provider>
  );
}
