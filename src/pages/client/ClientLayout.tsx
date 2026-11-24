import {LinkProvider} from '@astryxdesign/core/Link';
import {VStack} from '@astryxdesign/core/VStack';
import {useEffect, useRef, type ReactNode} from 'react';
import {Outlet, ScrollRestoration, useLocation} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {BottomNav, BOTTOM_NAV_SPACE, clientNavItems} from '../../components/BottomNav.tsx';
import {BookingFlowProvider} from '../../components/booking/BookingFlow.tsx';
import {BeautyFlowProvider, useBeauty} from '../../components/beauty/BeautyFlow.tsx';
import {SELECTION_BAR_SPACE, SelectionBar} from '../../components/beauty/SelectionBar.tsx';
import {PreviewBanner} from '../../components/PreviewBanner.tsx';
import {RouterLink} from '../../components/RouterLink.tsx';

export function ClientLayout() {
  const tenant = useTenant();
  const beauty = tenant.kind === 'beauty';
  const Provider = beauty ? BeautyFlowProvider : BookingFlowProvider;
  return (
    <LinkProvider component={RouterLink}>
      <Provider>
        <ScrollRestoration />
        {beauty ? <BeautyMain /> : <Main reserve={BOTTOM_NAV_SPACE} />}
        <BottomNav items={clientNavItems(tenant.slug)} />
      </Provider>
    </LinkProvider>
  );
}

/** Beauty: the page keeps room for the selection bar while a service is chosen. */
function BeautyMain() {
  const {service} = useBeauty();
  return (
    <>
      <Main reserve={service ? `calc(${BOTTOM_NAV_SPACE} + ${SELECTION_BAR_SPACE})` : BOTTOM_NAV_SPACE} />
      <SelectionBar />
    </>
  );
}

function Main({reserve}: {reserve: string}): ReactNode {
  const tenant = useTenant();
  const {pathname} = useLocation();
  const main = useRef<HTMLElement | null>(null);
  const first = useRef(true);

  // Move focus to the new page for keyboard and screen-reader users.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({preventScroll: true});
  }, [pathname]);

  return (
    <VStack as="main" ref={main} tabIndex={-1} aria-label={tenant.name} minHeight="100dvh" style={{paddingBottom: reserve, outline: 'none'}}>
      {tenant.status === 'preview' && <PreviewBanner />}
      <Outlet />
    </VStack>
  );
}
