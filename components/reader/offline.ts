'use client';

// Getting the reader itself onto the device. The service worker keeps what it's told
// to keep, and a page only knows which code it needed once it has run, so after the
// app is up it loads every book engine (they load lazily otherwise) and hands the
// worker the full list. The first visit, online, is enough to read offline from then on.

export const loadPdf = () => import('./engines/pdf');
export const loadEpub = () => import('./engines/epub');
export const loadText = () => import('./engines/text');
export const loadFlow = () => import('./engines/flow');
export const loadFixed = () => import('./engines/fixed');
export const loadMarkdownParts = () => import('react-markdown');

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
  // Only asks: browsers decide. On a home-screen app this keeps books from being cleared for space.
  void navigator.storage?.persist?.().catch(() => false);
  const registration = await navigator.serviceWorker.ready;
  const [pdf] = await Promise.all([loadPdf(), loadEpub(), loadText(), loadFlow(), loadFixed(), loadMarkdownParts()]);
  const list = await fetch(`${pdf.PDF_ASSETS}offline.json`).then((res) => (res.ok ? res.json() as Promise<string[]> : []), () => []);
  // No list means no connection or a failed deploy: leave what's kept alone.
  if (!list.length) return;
  const assets = ['offline.json', ...list].map((name) => pdf.PDF_ASSETS + name);
  registration.active?.postMessage({ type: 'reader-offline', code: loadedCode(), assets });
}
