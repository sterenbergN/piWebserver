'use client';

import { useEffect, useMemo, useState } from 'react';
import ProgressBar from './ProgressBar';

interface SystemStats { platform: string; temp: string; ram: string; storage: string; uptime?: string; cpu?: string; network?: string; networkTotal?: string; }
interface SiteVisit { timestamp: string; path: string; }

const DAY = 86_400_000;

/** Live Pi vitals (refreshed every 10 s) and page-view analytics. */
export default function OverviewPanel() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsState, setStatsState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [visits, setVisits] = useState<SiteVisit[] | null>(null);

  useEffect(() => {
    const fetchStats = () => fetch('/api/stats').then(r => r.json())
      .then(d => { if (d?.success) { setStats(d.data); setStatsState('ok'); } else setStatsState('error'); })
      .catch(() => setStatsState(s => (s === 'ok' ? s : 'error')));
    // The visit log can be large; load it once rather than with every stats refresh.
    fetch('/api/analytics').then(r => r.json()).then(d => { if (d?.success) setVisits(d.visits); }).catch(() => setVisits([]));
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, []);

  const summary = useMemo(() => {
    if (!visits) return null;
    const now = Date.now();
    const age = (v: SiteVisit) => now - new Date(v.timestamp).getTime();
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * DAY);
      return { key: dayKey(d), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), weekday: d.toLocaleDateString(undefined, { weekday: 'narrow' }), count: 0 };
    });
    const byKey = new Map(days.map(d => [d.key, d]));
    const pageCounts = new Map<string, number>();
    for (const v of visits) {
      const day = byKey.get(dayKey(new Date(v.timestamp)));
      if (day) day.count++;
      if (age(v) < 30 * DAY) pageCounts.set(v.path, (pageCounts.get(v.path) || 0) + 1);
    }
    return {
      counts: [
        { label: 'Last 24 hours', value: visits.filter(v => age(v) < DAY).length },
        { label: 'Last 7 days', value: visits.filter(v => age(v) < 7 * DAY).length },
        { label: 'Last 30 days', value: visits.filter(v => age(v) < 30 * DAY).length },
        { label: 'All time', value: visits.length },
      ],
      days,
      maxDay: Math.max(1, ...days.map(d => d.count)),
      topPages: [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [visits]);

  const tiles = stats ? [
    { label: 'Temperature', value: stats.temp },
    { label: 'Memory', value: stats.ram.split('/')[0].trim(), sub: stats.ram.split('/')[1] ? `of ${stats.ram.split('/')[1].trim()}` : undefined },
    { label: 'Storage', value: stats.storage.split('(')[0].trim(), sub: stats.storage.includes('(') ? stats.storage.slice(stats.storage.indexOf('(')) : undefined },
    ...(stats.cpu !== undefined ? [{ label: 'CPU use', value: `${stats.cpu}%` }] : []),
    ...(stats.uptime ? [{ label: 'Uptime', value: stats.uptime, small: true }] : []),
    // network is "↓ download | ↑ upload" (live speed); networkTotal is traffic since boot.
    ...(stats.network && stats.network !== 'N/A' ? [{ label: 'Network speed', value: stats.network.split('|')[0]?.trim() || '', sub: [stats.network.split('|')[1]?.trim(), stats.networkTotal].filter(Boolean).join(' · '), small: true }] : []),
  ] : [];

  return (
    <>
      <section className="adm-card" aria-labelledby="vitals-title">
        <div className="adm-card-head">
          <div>
            <h2 id="vitals-title">🖥️ Raspberry Pi</h2>
            <p>{stats?.platform ? `${stats.platform} · ` : ''}updates every 10 seconds</p>
          </div>
        </div>
        {statsState === 'loading' && !stats ? <ProgressBar label="Reading the Pi's vitals…" />
          : statsState === 'error' && !stats ? <div className="adm-notice is-error">Could not read system stats.</div>
          : (
            <div className="adm-stats">
              {tiles.map(tile => (
                <div key={tile.label} className="adm-stat">
                  <div className="adm-stat-label">{tile.label}</div>
                  <div className={`adm-stat-value${tile.small ? ' is-small' : ''}`}>{tile.value}</div>
                  {tile.sub && <div className="adm-stat-sub">{tile.sub}</div>}
                </div>
              ))}
            </div>
          )}
      </section>

      <section className="adm-card" aria-labelledby="visits-title">
        <div className="adm-card-head">
          <div>
            <h2 id="visits-title">📈 Visits</h2>
            <p>Page views on the site.</p>
          </div>
        </div>
        {!summary ? <ProgressBar label="Loading visits…" /> : (
          <>
            <div className="adm-stats">
              {summary.counts.map(c => (
                <div key={c.label} className="adm-stat">
                  <div className="adm-stat-label">{c.label}</div>
                  <div className="adm-stat-value">{c.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
              <div>
                <h3 className="adm-h3">Views per day · last 14 days</h3>
                <div className="adm-bars">
                  {summary.days.map(d => (
                    <div key={d.key} title={`${d.label}: ${d.count} views`}>
                      <div style={{ height: `${(d.count / summary.maxDay) * 100}%`, minHeight: d.count ? 2 : 0 }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '0.3rem' }}>
                  {summary.days.map(d => <span key={d.key} style={{ flex: 1, textAlign: 'center', fontSize: '0.65rem', color: 'var(--muted)' }}>{d.weekday}</span>)}
                </div>
              </div>
              <div className="adm-pages">
                <h3 className="adm-h3">Top pages · last 30 days</h3>
                {summary.topPages.length === 0 ? <p className="adm-muted">No visits yet.</p> : summary.topPages.map(([page, n]) => (
                  <div key={page} title={`${page}: ${n} views`}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{page}</span>
                    <div className="adm-progress" style={{ height: 8 }}><div style={{ width: `${(n / summary.topPages[0][1]) * 100}%` }} /></div>
                    <span style={{ textAlign: 'right', fontWeight: 700 }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
