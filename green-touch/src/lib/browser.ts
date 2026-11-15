import {useEffect, useSyncExternalStore} from 'react';
import {env} from './env.ts';

/** navigator.onLine as a live value. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    l => {
      window.addEventListener('online', l);
      window.addEventListener('offline', l);
      return () => {
        window.removeEventListener('online', l);
        window.removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Persist a form draft (survives reloads and app updates). */
export function loadDraft<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
export function saveDraft(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
export function dropDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Guest order tokens are kept in this browser only (never in the URL). */
const ORDERS = 'gt-orders';
export function rememberOrder(id: string, token: string): void {
  const all = loadDraft<Record<string, string>>(ORDERS) ?? {};
  all[id] = token;
  saveDraft(ORDERS, all);
}
export const orderToken = (id: string): string | null => loadDraft<Record<string, string>>(ORDERS)?.[id] ?? null;

type Meta = {title: string; description?: string; path?: string; jsonLd?: unknown; noindex?: boolean; image?: string | null};

function setTag(selector: string, create: () => HTMLElement, attr: string, value: string | null): void {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (value == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/** Unique title, description, canonical, Open Graph and structured data per page. */
export function useMeta(m: Meta): void {
  const ld = m.jsonLd ? JSON.stringify(m.jsonLd) : null;
  useEffect(() => {
    const title = m.title === 'Green Touch' ? m.title : `${m.title} — Green Touch`;
    document.title = title;
    const meta = (name: string, prop = false) => () => {
      const el = document.createElement('meta');
      el.setAttribute(prop ? 'property' : 'name', name);
      return el;
    };
    setTag('meta[name="description"]', meta('description'), 'content', m.description ?? null);
    setTag('meta[property="og:title"]', meta('og:title', true), 'content', title);
    setTag('meta[property="og:description"]', meta('og:description', true), 'content', m.description ?? null);
    setTag('meta[property="og:image"]', meta('og:image', true), 'content', m.image ?? null);
    setTag('meta[name="robots"]', meta('robots'), 'content', m.noindex ? 'noindex, nofollow' : null);
    const canonical = m.path != null ? `${env.siteUrl}${m.path}` : null;
    setTag('link[rel="canonical"]', () => Object.assign(document.createElement('link'), {rel: 'canonical'}), 'href', canonical);
    setTag('meta[property="og:url"]', meta('og:url', true), 'content', canonical);
    let script = document.head.querySelector<HTMLScriptElement>('script[data-ld="page"]');
    if (ld) {
      if (!script) {
        script = document.createElement('script');
        script.type = 'application/ld+json';
        script.dataset.ld = 'page';
        document.head.appendChild(script);
      }
      script.textContent = ld;
    } else script?.remove();
  }, [m.title, m.description, m.path, ld, m.noindex, m.image]);
}
