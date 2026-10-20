'use client';

import { useEffect } from 'react';

// The workout pages are built to fit a phone screen, so zooming only gets in
// the way (a stray pinch mid-set, or a double tap on a +/- button). The
// viewport tag stops zoom-on-focus; Safari on iPhone ignores its
// `user-scalable=no` for pinches, so those are blocked here, and
// `touch-action: manipulation` turns off double-tap zoom.

export default function NoZoom() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.touchAction;
    root.style.touchAction = 'manipulation';
    const block = (event: Event) => event.preventDefault();
    const blockPinch = (event: TouchEvent) => { if (event.touches.length > 1) event.preventDefault(); };
    // Safari-only pinch events.
    document.addEventListener('gesturestart', block, { passive: false });
    document.addEventListener('gesturechange', block, { passive: false });
    document.addEventListener('touchmove', blockPinch, { passive: false });
    return () => {
      root.style.touchAction = previous;
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
      document.removeEventListener('touchmove', blockPinch);
    };
  }, []);

  return null;
}
