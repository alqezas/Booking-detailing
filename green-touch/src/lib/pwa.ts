import {useSyncExternalStore} from 'react';
import {Workbox} from 'workbox-window';

/**
 * Service worker registration with an explicit «update» prompt: a new version
 * waits until the buyer agrees, so a half-filled checkout is never reloaded
 * underneath them (the draft is in localStorage anyway).
 */
let wb: Workbox | null = null;
let needRefresh = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // debugging escape hatch (e.g. embedded browsers that block worker fetches to a local Supabase)
  try {
    if (localStorage.getItem('gt-no-sw') === '1') return;
  } catch {
    /* ignore */
  }
  wb = new Workbox('/sw.js', {scope: '/'});
  wb.addEventListener('waiting', () => {
    // The admin has no checkout to interrupt and must never work on a stale build.
    if (location.pathname.startsWith('/admin')) {
      wb?.messageSkipWaiting();
      return;
    }
    needRefresh = true;
    emit();
  });
  // Long-open tabs (the owner keeps the admin open all day) still learn about new builds.
  setInterval(() => void wb?.update().catch(() => undefined), 30 * 60_000);
  // reload only when an update the buyer accepted takes over (not on the very first install)
  wb.addEventListener('controlling', e => {
    if (e.isUpdate) location.reload();
  });
  void wb.register().catch(() => undefined);
}

export function useAppUpdate(): {needRefresh: boolean; update: () => void} {
  const v = useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => needRefresh,
    () => false,
  );
  return {needRefresh: v, update: () => wb?.messageSkipWaiting()};
}

// ── «Add to home screen» ────────────────────────────────────────────────────
// Chrome/Edge/Samsung fire `beforeinstallprompt` (often before React mounts), so
// it is captured at module load. iOS has no such event: the buyer is shown how
// to do it via Share → «На екран "Додому"».
type InstallEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};
type InstallState = {prompt: InstallEvent | null; installed: boolean};
let install: InstallState = {prompt: null, installed: false};
const installListeners = new Set<() => void>();
const setInstall = (patch: Partial<InstallState>) => {
  install = {...install, ...patch};
  installListeners.forEach(l => l());
};
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // we show our own button instead of the mini-infobar
    setInstall({prompt: e as InstallEvent});
  });
  window.addEventListener('appinstalled', () => setInstall({prompt: null, installed: true}));
}

export type InstallPlatform = 'prompt' | 'ios' | 'other';

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true);

const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function useInstallApp(): {hidden: boolean; platform: InstallPlatform; install: () => Promise<void>} {
  const s = useSyncExternalStore(
    l => {
      installListeners.add(l);
      return () => installListeners.delete(l);
    },
    () => install,
    () => install,
  );
  const platform: InstallPlatform = s.prompt ? 'prompt' : isIos() ? 'ios' : 'other';
  return {
    hidden: s.installed || isStandalone(),
    platform,
    install: async () => {
      if (!s.prompt) return;
      await s.prompt.prompt();
      const {outcome} = await s.prompt.userChoice;
      // the event can be used only once
      setInstall({prompt: null, installed: outcome === 'accepted'});
    },
  };
}

/** Admin sign-out: make sure nothing private could remain in caches. */
export function clearRuntimeCaches(): void {
  navigator.serviceWorker?.controller?.postMessage({type: 'CLEAR_PRIVATE'});
}
