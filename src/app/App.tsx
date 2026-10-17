import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from 'react-router/dom';
import {ApiError} from '../lib/errors.ts';
import {ComponentLanguage} from './language.tsx';
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
    <ComponentLanguage>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ComponentLanguage>
  );
}
