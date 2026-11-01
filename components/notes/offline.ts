'use client';

import { loadPdfEngine } from './paper';

// Getting the app itself onto the device, the way the Reader does. The service worker keeps
// what it's told to keep, and a page only knows which code it needed once it has run, so after
// the app is up it loads what would otherwise load lazily (the PDF engine, the exporter) and
// hands the worker the full list. The first visit, online, is enough to work offline from then on.

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
  // Only asks: browsers decide. On a home-screen app this keeps your notes from being cleared for space.
  void navigator.storage?.persist?.().catch(() => false);
  const registration = await navigator.serviceWorker.ready;
  const [pdf] = await Promise.all([loadPdfEngine(), import('pdf-lib')]);
  const list = await fetch(`${pdf.PDF_ASSETS}offline.json`).then((res) => (res.ok ? res.json() as Promise<string[]> : []), () => []);
  // No list means no connection or a failed deploy: leave what's kept alone.
  if (!list.length) return;
  const assets = ['offline.json', ...list].map((name) => pdf.PDF_ASSETS + name);
  registration.active?.postMessage({ type: 'notes-offline', code: loadedCode(), assets });
}
