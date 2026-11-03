'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fix } from '@/lib/golf/types';

export type GpsState = { fix: Fix | null; error: string | null };

const toFix = (p: GeolocationPosition): Fix => ({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: new Date(p.timestamp).toISOString() });

function describe(e: GeolocationPositionError) {
  if (e.code === e.PERMISSION_DENIED) return 'Location is off for this site. Turn it on in your browser\'s settings to measure shots.';
  if (e.code === e.TIMEOUT) return 'Still looking for GPS…';
  return 'GPS isn\'t available right now.';
}

/** Readings worse than this get a warning before they're used. */
export const POOR_ACCURACY_M = 15;

/**
 * Live position while `active` (only while a screen that needs it is open, to save
 * battery). `best()` watches for a few seconds and keeps the most accurate reading,
 * because the first fix after standing still is often the worst.
 */
export function useGps(active: boolean) {
  const [state, setState] = useState<GpsState>({ fix: null, error: null });
  const latest = useRef<Fix | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) {
      setState({ fix: null, error: 'This browser has no GPS.' });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => { latest.current = toFix(p); setState({ fix: latest.current, error: null }); },
      (e) => setState((s) => ({ fix: s.fix, error: describe(e) })),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  const best = useCallback((ms = 4000) => new Promise<Fix>((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('This browser has no GPS.')); return; }
    let found: Fix | null = latest.current && Date.now() - Date.parse(latest.current.at) < 3000 ? latest.current : null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = toFix(p);
        if (!found || fix.acc <= found.acc) found = fix;
        if (found.acc <= 4) finish();
      },
      (e) => { if (e.code === e.PERMISSION_DENIED) { navigator.geolocation.clearWatch(id); clearTimeout(timer); reject(new Error(describe(e))); } },
      { enableHighAccuracy: true, maximumAge: 0, timeout: ms + 6000 },
    );
    const finish = () => {
      navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      if (found) resolve(found);
      else reject(new Error('No GPS fix yet. Try again in the open, away from trees.'));
    };
    const timer = setTimeout(finish, ms);
  }), []);

  return { ...state, best };
}
