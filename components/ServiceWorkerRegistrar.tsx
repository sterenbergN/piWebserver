'use client';

import { useEffect } from 'react';

/** Registers the service worker in production so the site can be installed and opened offline. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) r.unregister();
      }).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Not fatal: the site works without it (e.g. plain-HTTP LAN access).
    });
  }, []);
  return null;
}
