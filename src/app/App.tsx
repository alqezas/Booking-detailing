import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import ruRU from '@astryxdesign/core/locales/ru-RU.generated.js';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from 'react-router/dom';
import {ApiError} from '../lib/errors.ts';
import {router} from './router.tsx';

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
    <InternationalizationProvider locale="ru-RU" messages={{'ru-RU': ruRU}}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </InternationalizationProvider>
  );
}
