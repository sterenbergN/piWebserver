// Service worker: lets the installed app open and keep working with a flaky
// connection. Static build assets are cached forever (their names are hashed);
// pages are network-first with a cached fallback. API calls are never cached —
// offline workout saves are handled by the app's own save queue.
const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const PRECACHE_PAGES = ['/workout', '/workout/active'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE)
      .then((cache) => Promise.all(PRECACHE_PAGES.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, PAGE_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname.startsWith('/workout')) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(PAGE_CACHE);
          return (await cache.match(url.pathname)) || (await cache.match('/workout')) || Response.error();
        })
    );
  }
});
