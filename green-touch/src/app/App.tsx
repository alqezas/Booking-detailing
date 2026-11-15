import {LinkProvider} from '@astryxdesign/core/Link';
import {Theme} from '@astryxdesign/core/theme';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from 'react-router/dom';
import {RouterLink} from '../components/RouterLink.tsx';
import {ApiError} from '../lib/api.ts';
import {router} from './router.tsx';
import {shopTheme} from './theme.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status !== null && error.status < 500) && count < 2,
    },
    mutations: {retry: false},
  },
});

export function App() {
  return (
    <Theme theme={shopTheme} mode="light">
      <LinkProvider component={RouterLink}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LinkProvider>
    </Theme>
  );
}
