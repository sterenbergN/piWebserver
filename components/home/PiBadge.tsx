'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Live = { temp?: string; cpu?: string; uptime?: string };

/** "● Live from a Raspberry Pi · 48.2°C · 7% CPU · up 3d 4h" — links to the stats page. */
export default function PiBadge() {
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      if (document.hidden) return; // no polling from background tabs
      fetch('/api/stats').then(r => r.json()).then(d => { if (!stopped && d?.success) setLive(d.data); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    return () => { stopped = true; clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, []);

  const uptime = live?.uptime?.replace(/^up /, '').replace(/ days?/, 'd').replace(/ hours?/, 'h').replace(/ minutes?/, 'm').split(', ').slice(0, 2).join(' ');
  const parts = [
    live?.temp && live.temp !== 'N/A' && live.temp !== 'Unknown' ? live.temp : null,
    live?.cpu && live.cpu !== 'N/A' ? `${Math.round(Number(live.cpu))}% CPU` : null,
    uptime ? `up ${uptime}` : null,
  ].filter(Boolean);

  return (
    <Link href="/stats" className="home-pi" aria-label={`Served from a Raspberry Pi${parts.length ? `: ${parts.join(', ')}` : ''}. See live stats.`}>
      <span className="home-pi-dot" aria-hidden />
      <span>Live from a Raspberry Pi</span>
      {parts.map(p => <span key={p as string} className="home-pi-part">{p}</span>)}
    </Link>
  );
}
