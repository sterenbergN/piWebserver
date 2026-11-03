'use client';

// Getting the golf app onto the phone, the way Notes and the Reader do: once it has
// run, it loads the map code it would otherwise load later and hands the service
// worker the list of everything it used. One visit with signal is then enough to
// open it on the course with none. Map tiles aren't part of it: those stay in the
// browser's normal cache for the courses you've looked at.

function loadedCode() {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name);
  const tags = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[href]')].map((el) => ('src' in el ? el.src : el.href));
  const out = new Set<string>();
  for (const url of [...entries, ...tags]) {
    try {
      const parsed = new URL(url);
      if (parsed.origin === location.origin && parsed.pathname.startsWith('/_next/static/')) out.add(parsed.pathname + parsed.search);
    } catch { /* Not a real address. */ }
  }
  return [...out];
}

export async function prepareOffline() {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
  void navigator.storage?.persist?.().catch(() => false);
  const registration = await navigator.serviceWorker.ready;
  await import('leaflet').catch(() => null);
  registration.active?.postMessage({ type: 'golf-offline', code: loadedCode(), assets: [] });
}
