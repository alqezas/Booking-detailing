import {lazy, Suspense, type ReactNode} from 'react';
import {createBrowserRouter} from 'react-router';
import {ShopLayout} from '../components/ShopLayout.tsx';
import {ErrorState, Loading, NotFound} from '../components/Status.tsx';
import HomePage from '../pages/HomePage.tsx';

const CatalogPage = lazy(() => import('../pages/CatalogPage.tsx'));
const ItemPage = lazy(() => import('../pages/ItemPage.tsx'));
const CartPage = lazy(() => import('../pages/CartPage.tsx'));
const CheckoutPage = lazy(() => import('../pages/CheckoutPage.tsx'));
const OrderPage = lazy(() => import('../pages/OrderPage.tsx'));
const InfoPage = lazy(() => import('../pages/InfoPage.tsx'));
// The admin is a separate chunk: shoppers never download it.
const AdminRoot = lazy(() => import('../pages/admin/AdminRoot.tsx'));
const AdminOrders = lazy(() => import('../pages/admin/AdminOrders.tsx').then(m => ({default: m.AdminOrders})));
const AdminOrder = lazy(() => import('../pages/admin/AdminOrders.tsx').then(m => ({default: m.AdminOrder})));
const AdminItems = lazy(() => import('../pages/admin/AdminItems.tsx').then(m => ({default: m.AdminItems})));
const AdminItemEdit = lazy(() => import('../pages/admin/AdminItems.tsx').then(m => ({default: m.AdminItemEdit})));
const AdminContent = lazy(() => import('../pages/admin/AdminContent.tsx').then(m => ({default: m.AdminContent})));
const AdminLaunch = lazy(() => import('../pages/admin/AdminContent.tsx').then(m => ({default: m.AdminLaunch})));

const s = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;
const RouteError = () => <ErrorState error={new Error('Сторінку не вдалося відкрити. Оновіть її.')} onRetry={() => location.reload()} />;

export const INFO_PAGES = ['pro-brend', 'dostavka-i-oplata', 'kontakty', 'polityka-konfidentsiinosti', 'umovy-pokupky'] as const;

export const router = createBrowserRouter([
  {
    element: <ShopLayout />,
    errorElement: <RouteError />,
    children: [
      {index: true, element: <HomePage />},
      {path: 'katalog', element: s(<CatalogPage />)},
      {path: 'tovar/:slug', element: s(<ItemPage kind="product" />)},
      {path: 'nabir/:slug', element: s(<ItemPage kind="kit" />)},
      {path: 'koshyk', element: s(<CartPage />)},
      {path: 'oformlennia', element: s(<CheckoutPage />)},
      {path: 'zamovlennia/:id', element: s(<OrderPage />)},
      ...INFO_PAGES.map(slug => ({path: slug, element: s(<InfoPage slug={slug} />)})),
      {path: '*', element: <NotFound />},
    ],
  },
  {
    path: 'admin',
    element: s(<AdminRoot />),
    errorElement: <RouteError />,
    children: [
      {index: true, element: s(<AdminOrders />)},
      {path: 'zamovlennia/:id', element: s(<AdminOrder />)},
      {path: 'tovary', element: s(<AdminItems />)},
      {path: 'tovary/:id', element: s(<AdminItemEdit />)},
      {path: 'kontent', element: s(<AdminContent />)},
      {path: 'zapusk', element: s(<AdminLaunch />)},
    ],
  },
]);
