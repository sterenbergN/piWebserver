'use client';

import { useEffect } from 'react';

/** Registers the service worker in production so the site can be installed and opened offline. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Not fatal: the site works without it (e.g. plain-HTTP LAN access).
    });
  }, []);
  return null;
}
