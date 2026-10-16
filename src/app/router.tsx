import {lazy, Suspense, type ReactNode} from 'react';
import {createBrowserRouter} from 'react-router';
import {FullScreenError, FullScreenLoading} from '../components/StatusScreens.tsx';
import {ClientLayout} from '../pages/client/ClientLayout.tsx';
import {HomePage} from '../pages/client/HomePage.tsx';
import {RootPage} from '../pages/RootPage.tsx';
import {TenantRoot} from './tenant.tsx';

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

const s = (node: ReactNode) => <Suspense fallback={<FullScreenLoading />}>{node}</Suspense>;

export const router = createBrowserRouter([
  {path: '/', element: <RootPage />},
  {
    path: '/s/:slug',
    element: <TenantRoot />,
    errorElement: <FullScreenError title="Ошибка на странице" description="Обновите страницу." onRetry={() => location.reload()} />,
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
        ],
      },
      {path: '*', element: <FullScreenError title="Страница не найдена" description="Вернитесь на главную студии." />},
    ],
  },
  {path: '*', element: <RootPage />},
]);
