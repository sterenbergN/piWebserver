// Service worker: lets the installed app open and keep working with a flaky
// connection. Static build assets are cached forever (their names are hashed);
// pages are network-first with a cached fallback. API calls are never cached —
// offline workout saves are handled by the app's own save queue.
const VERSION = 'v2';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const PRECACHE_PAGES = ['/workout', '/workout/active'];
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="font-family:system-ui,sans-serif;background:#0a0a0c;color:#ededed;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">
<div><div style="font-size:3rem">📡</div><h1>You're offline</h1><p style="color:#a0aec0">This page needs a connection. Your workout log still works offline.</p>
<p><a href="/workout" style="color:#9f7aea">Open Workout</a> · <a href="" onclick="location.reload();return false" style="color:#9f7aea">Try again</a></p></div></body>`;

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
          const cached = await cache.match(url.pathname);
          if (cached) return cached;
          // The workout app works offline; other pages get a short notice.
          if (url.pathname.startsWith('/workout')) return (await cache.match('/workout')) || Response.error();
          return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        })
    );
  }
});
