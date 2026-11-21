/**
 * The admin as its own home-screen app («GT Адмін») and its session rules.
 *
 * - /admin is served with admin.webmanifest (prerender); when the owner reaches the
 *   admin by in-app navigation, the head tags are swapped here so «Install» /
 *   «На екран Додому» always creates the admin app, not a second shop icon.
 * - The session lives in sessionStorage (see supabase.ts): closing the app or the
 *   tab signs the owner out, so an installed icon never opens straight into the admin.
 * - After IDLE_MS without interaction (time in the background counts) the owner is
 *   signed out and must enter the password again.
 */
import {useEffect, useRef} from 'react';

export const IDLE_MS = 20 * 60_000;
const ACTIVITY_KEY = 'gt-admin-last-activity';

type HeadSnapshot = {manifest?: string; icon?: string; theme?: string; title?: string | null};

function setAttr(selector: string, attr: string, value: string, create: () => HTMLElement): string | undefined {
  let el = document.head.querySelector<HTMLElement>(selector);
  const prev = el?.getAttribute(attr) ?? undefined;
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
  return prev;
}

export function useAdminAppIdentity(): void {
  useEffect(() => {
    const snap: HeadSnapshot = {};
    snap.manifest = setAttr('link[rel="manifest"]', 'href', '/admin.webmanifest', () => Object.assign(document.createElement('link'), {rel: 'manifest'}));
    snap.icon = setAttr('link[rel="apple-touch-icon"]', 'href', '/icons/admin-maskable-512.png', () => Object.assign(document.createElement('link'), {rel: 'apple-touch-icon'}));
    snap.theme = setAttr('meta[name="theme-color"]', 'content', '#1F2B1C', () => Object.assign(document.createElement('meta'), {name: 'theme-color'}));
    snap.title = setAttr('meta[name="apple-mobile-web-app-title"]', 'content', 'GT Адмін', () => Object.assign(document.createElement('meta'), {name: 'apple-mobile-web-app-title'})) ?? null;
    return () => {
      // back to the shop identity when leaving the admin
      if (snap.manifest) document.head.querySelector('link[rel="manifest"]')?.setAttribute('href', snap.manifest);
      if (snap.icon) document.head.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', snap.icon);
      if (snap.theme) document.head.querySelector('meta[name="theme-color"]')?.setAttribute('content', snap.theme);
      const t = document.head.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (snap.title === null) t?.remove();
      else if (snap.title) t?.setAttribute('content', snap.title);
    };
  }, []);
}

const now = () => Date.now();
const readActivity = () => {
  try {
    return Number(sessionStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeActivity = (t: number) => {
  try {
    sessionStorage.setItem(ACTIVITY_KEY, String(t));
  } catch {
    /* ignore */
  }
};

/** Signs the owner out after IDLE_MS without interaction, including time in the background. */
export function useIdleSignOut(active: boolean, signOut: () => void): void {
  const cb = useRef(signOut);
  cb.current = signOut;
  useEffect(() => {
    if (!active) return;
    const last = readActivity();
    if (last && now() - last > IDLE_MS) {
      cb.current();
      return;
    }
    writeActivity(now());
    let throttle = 0;
    const touch = () => {
      const t = now();
      if (t - throttle > 15_000) {
        throttle = t;
        writeActivity(t);
      }
    };
    const check = () => {
      if (now() - readActivity() > IDLE_MS) cb.current();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, touch, {passive: true}));
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 30_000);
    return () => {
      events.forEach(e => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [active]);
}

export const clearIdleMark = () => {
  try {
    sessionStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
};
