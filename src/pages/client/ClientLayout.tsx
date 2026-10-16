import {LinkProvider} from '@astryxdesign/core/Link';
import {VStack} from '@astryxdesign/core/VStack';
import {useEffect, useRef} from 'react';
import {Outlet, ScrollRestoration, useLocation} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {BottomNav, BOTTOM_NAV_SPACE} from '../../components/BottomNav.tsx';
import {BookingFlowProvider} from '../../components/booking/BookingFlow.tsx';
import {PreviewBanner} from '../../components/PreviewBanner.tsx';
import {RouterLink} from '../../components/RouterLink.tsx';

export function ClientLayout() {
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
    <LinkProvider component={RouterLink}>
      <BookingFlowProvider>
        <ScrollRestoration />
        <VStack
          as="main"
          ref={main}
          tabIndex={-1}
          aria-label={tenant.name}
          minHeight="100dvh"
          style={{paddingBottom: BOTTOM_NAV_SPACE, outline: 'none'}}
        >
          {tenant.status === 'preview' && <PreviewBanner />}
          <Outlet />
        </VStack>
        <BottomNav slug={tenant.slug} />
      </BookingFlowProvider>
    </LinkProvider>
  );
}
