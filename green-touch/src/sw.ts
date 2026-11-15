/// <reference lib="webworker" />
/**
 * Green Touch service worker (vite-plugin-pwa injectManifest + Workbox).
 * Cached: the app shell, public catalog reads (bounded), product photos, fonts.
 * Never cached: auth, Edge Functions (checkout, payment, orders, Nova Poshta),
 * admin pages and every other REST call. Nothing is queued offline:
 * an order or payment can only be made with a live connection.
 */
import {clientsClaim, setCacheNameDetails} from 'workbox-core';
import {ExpirationPlugin} from 'workbox-expiration';
import {cleanupOutdatedCaches, matchPrecache, precacheAndRoute} from 'workbox-precaching';
import {NavigationRoute, registerRoute, setCatchHandler} from 'workbox-routing';
import {NetworkFirst, NetworkOnly, StaleWhileRevalidate} from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {__WB_MANIFEST: Array<{url: string; revision: string | null}>};

setCacheNameDetails({prefix: 'gt', suffix: 'v1'});
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
clientsClaim();

// A new version waits for the buyer's «Оновити» (see src/lib/pwa.ts).
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
  if (event.data?.type === 'CLEAR_PRIVATE') event.waitUntil(caches.delete('gt-catalog-v1').then(() => undefined));
});

const PUBLIC_RPC = /\/rest\/v1\/rpc\/(catalog_meta|catalog_search|catalog_item|public_page)$/;

// Admin pages: always from the network (offline → offline page).
registerRoute(new NavigationRoute(new NetworkOnly(), {allowlist: [/^\/admin/]}));

// Shop pages: network first; offline → the cached app shell (it renders the cached catalog).
registerRoute(
  new NavigationRoute(
    async options => {
      try {
        return await new NetworkFirst({cacheName: 'gt-pages-v1', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({maxEntries: 40})]}).handle(options);
      } catch {
        return (await matchPrecache('/index.html')) ?? (await matchPrecache('/offline.html')) ?? Response.error();
      }
    },
    {denylist: [/^\/admin/]},
  ),
);

// Public catalog (anonymous GET RPCs only): bounded, short-lived copy for offline browsing.
registerRoute(
  // These four functions return only published catalog data and public settings (security definer, no user data).
  ({url, request}) => request.method === 'GET' && PUBLIC_RPC.test(url.pathname),
  new NetworkFirst({
    cacheName: 'gt-catalog-v1',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({maxEntries: 80, maxAgeSeconds: 3 * 86400})],
  }),
);

// Product photos from the public bucket.
registerRoute(
  ({url, request}) => request.method === 'GET' && url.pathname.includes('/storage/v1/object/public/catalog/'),
  new StaleWhileRevalidate({cacheName: 'gt-images-v1', plugins: [new ExpirationPlugin({maxEntries: 150, maxAgeSeconds: 30 * 86400})]}),
);

registerRoute(
  ({url}) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({cacheName: 'gt-fonts-v1', plugins: [new ExpirationPlugin({maxEntries: 20})]}),
);

setCatchHandler(async ({request}) => {
  if (request.destination === 'document') return (await matchPrecache('/offline.html')) ?? Response.error();
  return Response.error();
});
