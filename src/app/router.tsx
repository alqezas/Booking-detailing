import {lazy, Suspense, type ReactNode} from 'react';
import {createBrowserRouter} from 'react-router';
import {FullScreenError, FullScreenLoading} from '../components/StatusScreens.tsx';
import {ClientLayout} from '../pages/client/ClientLayout.tsx';
import {HomePage} from '../pages/client/HomePage.tsx';
import {RootPage} from '../pages/RootPage.tsx';
import {TenantRoot} from './tenant.tsx';
import {msg} from '../i18n/index.ts';

// The cabinet and the assistant are separate chunks: customers never download them.
const ServicesPage = lazy(() => import('../pages/client/ServicesPage.tsx'));
const MyBookingPage = lazy(() => import('../pages/client/MyBookingPage.tsx'));
const AssistantPage = lazy(() => import('../pages/client/AssistantPage.tsx'));
const OwnerRoot = lazy(() => import('../pages/owner/OwnerRoot.tsx'));
const OwnerLogin = lazy(() => import('../pages/owner/OwnerLogin.tsx'));
const OwnerBookingsPage = lazy(() => import('../pages/owner/OwnerBookingsPage.tsx'));
const OwnerStatsPage = lazy(() => import('../pages/owner/OwnerStatsPage.tsx'));
const OwnerSettingsPage = lazy(() => import('../pages/owner/OwnerSettingsPage.tsx'));
const OwnerAssistantPage = lazy(() => import('../pages/owner/OwnerAssistantPage.tsx'));
const OwnerTiresPage = lazy(() => import('../pages/owner/OwnerTiresPage.tsx'));
const OwnerPassesPage = lazy(() => import('../pages/owner/OwnerPassesPage.tsx'));

// Rendered lazily so the texts follow the studio language set by TenantRoot.
const RouteError = () => <FullScreenError title={msg.app.pageError} description={msg.app.pageErrorHint} onRetry={() => location.reload()} />;
const NotFound = () => <FullScreenError title={msg.app.pageNotFound} description={msg.app.pageNotFoundHint} />;

const s = (node: ReactNode) => <Suspense fallback={<FullScreenLoading />}>{node}</Suspense>;

export const router = createBrowserRouter([
  {path: '/', element: <RootPage />},
  {
    path: '/s/:slug',
    element: <TenantRoot />,
    errorElement: <RouteError />,
    children: [
      {
        element: <ClientLayout />,
        children: [
          {index: true, element: <HomePage />},
          {path: 'services', element: s(<ServicesPage />)},
          {path: 'my', element: s(<MyBookingPage />)},
          {path: 'assistant', element: s(<AssistantPage />)},
        ],
      },
      {path: 'owner/login', element: s(<OwnerLogin />)},
      {
        path: 'owner',
        element: s(<OwnerRoot />),
        children: [
          {index: true, element: s(<OwnerBookingsPage />)},
          {path: 'stats', element: s(<OwnerStatsPage />)},
          {path: 'settings', element: s(<OwnerSettingsPage />)},
          {path: 'assistant', element: s(<OwnerAssistantPage />)},
          {path: 'tires', element: s(<OwnerTiresPage />)},
          {path: 'passes', element: s(<OwnerPassesPage />)},
        ],
      },
      {path: '*', element: <NotFound />},
    ],
  },
  {path: '*', element: <RootPage />},
]);
