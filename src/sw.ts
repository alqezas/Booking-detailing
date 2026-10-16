/// <reference lib="webworker" />
/**
 * One worker source, installed separately per studio at /s/<slug>/sw.js.
 * Cache names carry the slug, so studios never share or evict each other's
 * caches. Only public data is cached: the shared bundle, the studio shell,
 * its photos and the public studio card. Bookings, owner data, auth and the
 * assistant always go to the network and are never stored here.
 */
import {cleanupOutdatedCaches, precacheAndRoute} from 'workbox-precaching';
import {clientsClaim, setCacheNameDetails} from 'workbox-core';
import {registerRoute, NavigationRoute} from 'workbox-routing';
import {NetworkFirst, StaleWhileRevalidate} from 'workbox-strategies';
import {ExpirationPlugin} from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & {__WB_MANIFEST: Array<{url: string; revision: string | null}>};

const scopePath = new URL(self.registration.scope).pathname; // /s/<slug>/
const slug = scopePath.split('/')[2] ?? 'unknown';
const prefix = `studio-${slug}`;
const SHELL = `${prefix}-shell`;

setCacheNameDetails({prefix, suffix: 'v1', precache: 'precache', runtime: 'runtime'});
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL).then(c =>
      c.addAll([scopePath, `${scopePath}manifest.webmanifest`, `${scopePath}icons/icon-192.png`]).catch(() => undefined),
    ),
  );
});

// Studio pages: network first, the cached shell when offline.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({cacheName: SHELL, networkTimeoutSeconds: 4}),
    {allowlist: [new RegExp(`^${scopePath.replace(/\//g, '\\/')}`)]},
  ),
);

// The studio's own static media, icons and startup images.
registerRoute(
  ({url, sameOrigin}) => sameOrigin && url.pathname.startsWith(scopePath) && /\/(media|icons|splash)\//.test(url.pathname),
  new StaleWhileRevalidate({cacheName: `${prefix}-media`, plugins: [new ExpirationPlugin({maxEntries: 120, maxAgeSeconds: 30 * 86400})]}),
);

// Owner-uploaded photos (public bucket only).
registerRoute(
  ({url}) => url.pathname.includes('/storage/v1/object/public/tenant-media/'),
  new StaleWhileRevalidate({cacheName: `${prefix}-uploads`, plugins: [new ExpirationPlugin({maxEntries: 120, maxAgeSeconds: 30 * 86400})]}),
);

// The public studio card (no personal data) so the home page opens offline.
registerRoute(
  ({url, request}) =>
    request.method === 'GET' &&
    url.pathname.endsWith('/rest/v1/rpc/public_get_tenant') &&
    url.searchParams.get('p_slug') === slug,
  new NetworkFirst({cacheName: `${prefix}-public`, networkTimeoutSeconds: 4}),
);

// Fonts
registerRoute(
  ({url}) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({cacheName: 'studio-fonts', plugins: [new ExpirationPlugin({maxEntries: 20})]}),
);

self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_PRIVATE') {
    // Nothing private is cached by design; drop any runtime cache defensively.
    event.waitUntil(caches.delete(`${prefix}-runtime-v1`).then(() => undefined));
  }
});

type PushPayload = {title?: string; body?: string; url?: string; tag?: string};

self.addEventListener('push', event => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = {body: event.data?.text()};
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Напоминание о записи', {
      body: data.body ?? '',
      tag: data.tag ?? 'booking-reminder',
      icon: `${scopePath}icons/icon-192.png`,
      badge: `${scopePath}icons/icon-192.png`,
      data: {url: data.url && data.url.startsWith(scopePath) ? data.url : `${scopePath}my`},
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data as {url?: string} | null)?.url ?? `${scopePath}my`;
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
      const existing = list.find(c => new URL(c.url).pathname.startsWith(scopePath));
      if (existing) {
        void existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
