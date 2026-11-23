'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// App-style tabs along the bottom of the workout pages on a phone, so the
// main sections are always one tap apart. Hidden mid-workout and on pages
// opened from a link or QR code.

const TABS = [
  { href: '/workout', label: 'Train', icon: '🏋️', match: (p: string, tab: string) => p === '/workout' },
  { href: '/workout/analytics', label: 'Progress', icon: '📈', match: (p: string, tab: string) => p === '/workout/analytics' && tab !== 'coach' },
  { href: '/workout/analytics?tab=coach', label: 'Coach', icon: '🧭', match: (p: string, tab: string) => p === '/workout/analytics' && tab === 'coach' },
  { href: '/workout/food', label: 'Food', icon: '🍽️', match: (p: string) => p === '/workout/food' },
  { href: '/workout/health', label: 'Health', icon: '❤️', match: (p: string) => p === '/workout/health' },
];
const HIDDEN = ['/workout/active', '/workout/station', '/workout/shared-gym', '/workout/shared-workout', '/workout/config/qr', '/workout/users'];

export default function WorkoutTabBar() {
  const pathname = usePathname() || '';
  const [tab, setTab] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    // The Analytics page switches tabs in place; follow its ?tab= query param.
    const read = () => setTab(new URLSearchParams(window.location.search).get('tab') || '');
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('workout:tabchange', read); // Analytics switching tabs in place
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('workout:tabchange', read);
    };
  }, [pathname]);
  if (!mounted || HIDDEN.some((p) => pathname.startsWith(p))) return null;
  // Into <body>: the page's fade-in uses a transform, which would pin a fixed bar to the page instead of the screen.
  // One column per tab (the stylesheet's default is four); workout.css pads <body> via body:has(.wtb) so the footer clears the bar.
  return createPortal(
    <nav className="wtb" aria-label="Workout sections" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
      {TABS.map((t) => {
        const current = t.match(pathname, tab);
        return (
          <a key={t.href} href={t.href} className={current ? 'is-current' : ''} aria-current={current ? 'page' : undefined}>
            <span aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </a>
        );
      })}
    </nav>,
    document.body,
  );
}
