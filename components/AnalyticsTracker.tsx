'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const SESSION_MS = 1_800_000;
const STORAGE_KEY = 'lastSiteVisits';

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    // Ignore api/admin paths for tracking
    if (pathname.startsWith('/api') || pathname.startsWith('/admin')) {
      return;
    }

    try {
      const now = Date.now();
      let visits: Record<string, number> = {};
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) visits = raw;
      } catch {
        visits = {};
      }

      const lastVisit = typeof visits[pathname] === 'number' && Number.isFinite(visits[pathname]) ? visits[pathname] : 0;

      // 30-minute session expiry (1800000 ms), keyed per pathname
      if (now - lastVisit > SESSION_MS) {
        // Track unique visitor ping
        fetch('/api/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pathname })
        }).catch(console.error);
      }

      // Prune expired entries and prolong this pathname's session window
      const next: Record<string, number> = {};
      for (const [key, ts] of Object.entries(visits)) {
        if (typeof ts === 'number' && Number.isFinite(ts) && now - ts <= SESSION_MS) {
          next[key] = ts;
        }
      }
      next[pathname] = now;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Catch in case localStorage is disabled or throws an error
    }

  }, [pathname]);

  return null;
}
