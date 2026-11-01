// Service worker: lets the installed app open and keep working with a flaky
// connection. Static build assets are cached forever (their names are hashed);
// pages are network-first with a cached fallback. API calls are never cached —
// offline workout saves are handled by the app's own save queue.
//
// The Reader has a cache of its own that outlives version changes, because it has to
// open with no connection long after its last visit. It holds the page and exactly the
// code that page uses, which the page lists for us each time it runs (see
// components/reader/offline.ts). Books and notes are in the page's own database.
// The Notes app gets the same treatment with a cache of its own, so an update to one
// never takes the other down with it.
const VERSION = 'v6';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const READER_CACHE = 'reader-v1';
const READER_PAGE = '/reader';
const NOTES_CACHE = 'notes-v1';
const NOTES_PAGE = '/notes';
const READER_ASSETS = '/reader-assets/';
const READER_PAGE_WAIT_MS = 2500;
const PRECACHE_PAGES = ['/workout', '/workout/active', '/workout/config', '/today', '/recipes'];
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
      .then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, PAGE_CACHE, READER_CACHE, NOTES_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** Keep an app's page and the code it lists; let go of what an older version used. */
async function keepApp(cacheName, pagePath, code, assets) {
  const cache = await caches.open(cacheName);
  // Offline there's nothing to gain, and everything to lose if the list came up short.
  const page = await fetch(pagePath, { credentials: 'same-origin' }).catch(() => null);
  if (!page || !page.ok) return;
  await cache.put(pagePath, page);
  const wanted = new Set([pagePath, ...code, ...assets].map((path) => new URL(path, self.location.origin).href));
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) await cache.delete(request);
  }
  const missing = [];
  for (const path of [...code, ...assets]) {
    if (!(await cache.match(path))) missing.push(path);
  }
  // A few at a time: the character maps alone are 170 small files.
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map((path) => cache.add(path).catch(() => {})));
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'reader-offline') {
    event.waitUntil(keepApp(READER_CACHE, READER_PAGE, event.data.code || [], event.data.assets || []));
  }
  if (event.data && event.data.type === 'notes-offline') {
    event.waitUntil(keepApp(NOTES_CACHE, NOTES_PAGE, event.data.code || [], event.data.assets || []));
  }
});

/** The network if it answers soon, since a Pi on a bad connection can hang. Otherwise what's kept. */
async function appPage(event, cacheName, pagePath) {
  const cache = await caches.open(cacheName);
  const network = fetch(event.request).then((response) => {
    if (response.ok) cache.put(pagePath, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  const cached = await cache.match(pagePath);
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), READER_PAGE_WAIT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' && url.pathname === READER_PAGE) {
    event.respondWith(appPage(event, READER_CACHE, READER_PAGE));
    return;
  }

  if (request.mode === 'navigate' && url.pathname === NOTES_PAGE) {
    event.respondWith(appPage(event, NOTES_CACHE, NOTES_PAGE));
    return;
  }

  if (url.pathname.startsWith(READER_ASSETS)) {
    event.respondWith(
      caches.open(READER_CACHE).then(async (cache) => {
        // Across every cache, since Notes keeps its own copy of the PDF engine.
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        // Across every cache, so the Reader's kept code still answers after a version change.
        const cached = await caches.match(request);
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
          // Kept fresh so the recipe box still opens with no signal at the store.
          if (response.ok && (url.pathname.startsWith('/workout') || url.pathname === '/recipes')) {
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
