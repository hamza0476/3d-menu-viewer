/* Platera guest-menu service worker (Phase 5).
 *
 * One job: repeat opens of a restaurant menu should feel instant, even
 * on weak restaurant Wi-Fi. Strategies, deliberately conservative:
 *   - Menu payload GET /api/menu/<id>: stale-while-revalidate — serve
 *     the cached payload immediately, refresh it in the background, so
 *     prices are never more than one visit stale.
 *   - Menu page navigations: network-first, falling back to the cached
 *     page when the network fails (offline re-open of a visited menu).
 *   - Static assets (/_next/static, /fonts, /images): cache-first —
 *     they are content-hashed or effectively immutable.
 * Everything else (all POSTs — including every guest event — other API
 * routes, dashboard pages) is left completely alone: this worker never
 * caches a mutation or an authenticated response.
 * Bump SW_VERSION to retire old caches.
 */
const SW_VERSION = 'platera-sw-v1';
const STATIC_CACHE = SW_VERSION + '-static';
const MENU_CACHE = SW_VERSION + '-menu';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(SW_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/menu/')) {
    event.respondWith(staleWhileRevalidate(req, MENU_CACHE));
    return;
  }
  if (req.mode === 'navigate' && url.pathname.startsWith('/menu/')) {
    event.respondWith(networkFirst(req, MENU_CACHE));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/images/')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
  }
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (cached) { refresh.catch(() => {}); return cached; }
  const fresh = await refresh;
  return fresh || new Response('Offline', { status: 503 });
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
