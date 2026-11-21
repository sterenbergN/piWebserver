'use client';

import { useEffect } from 'react';

type Sentinel = { released: boolean; release: () => Promise<void>; addEventListener: (type: 'release', listener: () => void) => void };

/**
 * Keep the screen on while `active` (workouts, party games). The browser drops
 * the lock whenever the page is hidden, and iPhones can drop it at other times
 * too, or refuse it until the page has been tapped, so it's taken again when
 * the page comes back and on any tap while it isn't held. iOS only counts
 * touchend/click/keydown as a user activation (not pointerdown), so a request
 * refused on load keeps being refused until one of those — hence listening to all.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: Sentinel | null = null;
    let pending = false;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || pending || (lock && !lock.released) || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const sentinel: Sentinel = await (navigator as any).wakeLock.request('screen');
        if (cancelled) {
          sentinel.release().catch(() => {});
        } else {
          lock = sentinel;
          sentinel.addEventListener('release', () => { if (lock === sentinel) lock = null; });
        }
      } catch {
        // Refused (battery saver, or no tap yet) — the next tap tries again.
      } finally {
        pending = false;
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    const onTap = () => { acquire(); };
    const tapEvents = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    tapEvents.forEach((e) => document.addEventListener(e, onTap, true));
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      tapEvents.forEach((e) => document.removeEventListener(e, onTap, true));
      lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}
