'use client';

import { useCallback, useEffect, useState } from 'react';

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IOSOrientationConstructor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Which way the top of the phone points, in degrees from north. iPhones only give
 * the compass after a tap asks permission, so `start()` must run from a button.
 * Android reports it through `deviceorientationabsolute`. Phone compasses are good
 * to roughly ±15°, and worse next to metal (a cart, a bag of clubs).
 */
export function useCompass() {
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<'off' | 'on' | 'denied' | 'missing'>('off');

  const start = useCallback(async () => {
    const Ctor = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as IOSOrientationConstructor | undefined;
    if (!Ctor) { setStatus('missing'); return false; }
    if (typeof Ctor.requestPermission === 'function') {
      const answer = await Ctor.requestPermission().catch(() => 'denied' as const);
      if (answer !== 'granted') { setStatus('denied'); return false; }
    }
    setStatus('on');
    return true;
  }, []);

  useEffect(() => {
    if (status !== 'on') return;
    // Screen rotation turns the phone's frame; screen.orientation.angle undoes it.
    const screenAngle = () => (screen.orientation?.angle ?? 0);
    const onIOS = (e: Event) => {
      const h = (e as IOSOrientationEvent).webkitCompassHeading;
      if (typeof h === 'number') setHeading((h + screenAngle()) % 360);
    };
    const onAbsolute = (e: Event) => {
      const alpha = (e as DeviceOrientationEvent).alpha;
      if (typeof alpha === 'number') setHeading((360 - alpha + screenAngle()) % 360);
    };
    window.addEventListener('deviceorientation', onIOS);
    window.addEventListener('deviceorientationabsolute', onAbsolute);
    // Some phones never send either: say so rather than show a frozen needle.
    const timer = setTimeout(() => setHeading((h) => { if (h === null) setStatus('missing'); return h; }), 3000);
    return () => {
      window.removeEventListener('deviceorientation', onIOS);
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
      clearTimeout(timer);
    };
  }, [status]);

  return { heading, status, start };
}
