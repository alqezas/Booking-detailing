import {useEffect, useState} from 'react';

/**
 * Each studio has its own service worker at /s/<slug>/sw.js with scope
 * /s/<slug>/, so installs, caches and push subscriptions never mix between
 * studios even though all of them share one JS bundle.
 */
export function registerTenantWorker(slug: string): void {
  if (!slug || !('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV && !import.meta.env.VITE_SW_DEV) return;
  const scope = `/s/${slug}/`;
  void navigator.serviceWorker.register(`${scope}sw.js`, {scope}).catch(() => undefined);
}

export async function tenantWorker(slug: string): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(`/s/${slug}/`);
  return reg ?? null;
}

/** Tell this studio's worker to drop everything cached for the signed-in owner. */
export async function clearPrivateCaches(slug: string): Promise<void> {
  const reg = await tenantWorker(slug);
  reg?.active?.postMessage({type: 'CLEAR_PRIVATE'});
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

type BeforeInstallPromptEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach(l => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach(l => l());
  });
}

/** 'prompt' — the browser can install now; 'ios' — show Share → «На экран „Домой“»; null — nothing to offer. */
export function useInstallOffer(): {kind: 'prompt' | 'ios' | null; install: () => Promise<void>} {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (isStandalone()) return {kind: null, install: async () => undefined};
  if (deferred) {
    return {
      kind: 'prompt',
      install: async () => {
        const e = deferred;
        deferred = null;
        await e?.prompt();
        listeners.forEach(l => l());
      },
    };
  }
  if (isIOS()) return {kind: 'ios', install: async () => undefined};
  return {kind: null, install: async () => undefined};
}
