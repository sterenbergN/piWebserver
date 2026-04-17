'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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
      const lastVisitStr = localStorage.getItem('lastSiteVisit');
      const lastVisit = lastVisitStr ? parseInt(lastVisitStr, 10) : 0;

      // 30-minute session expiry (1800000 ms)
      if (now - lastVisit > 1800000) {
        // Track unique visitor ping
        fetch('/api/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pathname })
        }).catch(console.error);
      }
      
      // Always prolong their session if they are navigating or switching tabs
      localStorage.setItem('lastSiteVisit', now.toString());
    } catch (e) {
      // Catch in case localStorage is disabled visually or throws an error
    }

  }, [pathname]);

  return null;
}
