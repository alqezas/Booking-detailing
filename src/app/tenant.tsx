import {Theme} from '@astryxdesign/core';
import {useQuery} from '@tanstack/react-query';
import {createContext, useContext, useEffect, type ReactNode} from 'react';
import {Outlet, useParams} from 'react-router';
import {getTenant} from '../lib/api/public.ts';
import {ApiError} from '../lib/errors.ts';
import type {PublicTenant} from '../lib/types.ts';
import {registerTenantWorker} from '../lib/pwa.ts';
import {DEFAULT_ACCENT, studioTheme} from './theme.ts';
import {FullScreenError, FullScreenLoading} from '../components/StatusScreens.tsx';
import {langOf, msg, setLang, setPhoneCountry} from '../i18n/index.ts';
import {ComponentLanguage} from './language.tsx';

const TenantContext = createContext<PublicTenant | null>(null);

export function useTenant(): PublicTenant {
  const t = useContext(TenantContext);
  if (!t) throw new Error('useTenant outside TenantRoot');
  return t;
}

export const tenantQueryKey = (slug: string) => ['tenant', slug] as const;

export function useTenantQuery(slug: string) {
  return useQuery({
    queryKey: tenantQueryKey(slug),
    queryFn: () => getTenant(slug),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

/** Light theme: beauty studios, unless their config says "appearance": "dark". */
export const isLightTenant = (t: Pick<PublicTenant, 'kind' | 'appearance'>): boolean => t.kind === 'beauty' && t.appearance !== 'dark';

/** Loads the studio by the slug in the URL and themes everything below it. */
export function TenantRoot(): ReactNode {
  const {slug = ''} = useParams();
  const q = useTenantQuery(slug);

  useEffect(() => {
    registerTenantWorker(slug);
  }, [slug]);

  useEffect(() => {
    if (q.data) document.title = q.data.name;
  }, [q.data]);

  // Switch the interface language before anything of this studio renders.
  if (q.data) {
    setLang(langOf(q.data.locale), q.data.kind, q.data.vocabulary);
    if (q.data.kind === 'beauty') setPhoneCountry(q.data.phone);
  }
  const accent = q.data?.accent_color ?? DEFAULT_ACCENT;
  // Beauty studios are light unless they ask for the dark theme (barbershops);
  // car studios keep the black theme.
  const light = q.data ? isLightTenant(q.data) : document.documentElement.dataset.astryxMode === 'light';
  return (
    <Theme theme={studioTheme(accent, light ? (q.data?.appearance === 'cream' ? 'cream' : 'light') : 'dark')} mode={light ? 'light' : 'dark'}>
      {q.isPending ? (
        <FullScreenLoading />
      ) : q.isError ? (
        q.error instanceof ApiError && q.error.status === 404 ? (
          <FullScreenError title={msg.app.studioNotFound} description={msg.app.studioNotFoundHint} />
        ) : (
          <FullScreenError title={msg.app.studioLoadFailed} description={q.error.message} onRetry={() => void q.refetch()} />
        )
      ) : (
        <ComponentLanguage key={`${msg.lang}:${q.data.kind}:${q.data.vocabulary ?? ''}`}>
          <TenantContext.Provider value={q.data}>
            <Outlet />
          </TenantContext.Provider>
        </ComponentLanguage>
      )}
    </Theme>
  );
}
