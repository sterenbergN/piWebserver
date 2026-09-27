'use client';

import { useState, useEffect } from 'react';

interface SystemStats {
  platform: string;
  temp: string;
  ram: string;
  storage: string;
  uptime?: string;
  cpu?: string;
  network?: string;
  networkTotal?: string;
}

interface StatHistory {
  timestamp: string;
  temp: number | null;
  ramUsed: number | null;
  cpuLoad: number | null;
}

type StatType = 'temp' | 'ram' | 'cpu';

const calculateAverages = (history: StatHistory[], type: StatType, mins: number) => {
  if (!history || history.length === 0) return null;
  const cutoff = new Date(Date.now() - mins * 60000).getTime();
  const relevant = history.filter(h => new Date(h.timestamp).getTime() > cutoff);
  if (relevant.length === 0) return null;
  
  // Readings the collector couldn't take are null; average only real ones.
  const avg = (pick: (h: StatHistory) => number | null | undefined) => {
    const values = relevant.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const value = type === 'temp' ? avg(h => h.temp) : type === 'cpu' ? avg(h => h.cpuLoad) : type === 'ram' ? avg(h => h.ramUsed) : null;
  if (value === null) return null;
  if (type === 'temp') return value.toFixed(1) + '°C';
  if (type === 'cpu') return value.toFixed(1) + '%';
  if (type === 'ram') return value.toFixed(1) + 'GB';
  return null;
};

const StatTile = ({ label, value, sub, history, type }: { label: string; value: string; sub?: string; history?: StatHistory[]; type?: StatType }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-panel" 
      onClick={() => history && type && setExpanded(!expanded)}
      style={{ textAlign: 'center', padding: 'clamp(1rem, 4vw, 2rem) 1rem', cursor: history && type ? 'pointer' : 'default', transition: 'all 0.2s ease', position: 'relative', gridColumn: expanded ? '1 / -1' : undefined }}>
      
      {history && type && (
        <div style={{ position: 'absolute', top: '10px', right: '12px', opacity: 0.4, fontSize: '0.8rem' }}>
          {expanded ? '▲' : '▼'}
        </div>
      )}

      <h3 style={{ color: 'var(--accent-light)', marginBottom: '0.5rem', fontSize: '0.78rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</h3>
      <p style={{ fontSize: 'clamp(1.35rem, 5vw, 2.2rem)', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--foreground)', overflowWrap: 'anywhere' }}>{value}</p>
      {sub && <p style={{ fontSize: '0.9rem', marginTop: '0.25rem', opacity: 0.6, marginBottom: 0 }}>{sub}</p>}

      {expanded && history && type && (
        <div className="animate-fade-in" style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--surface-border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {[
            { label: '10 Min', val: calculateAverages(history, type, 10) },
            { label: '1 Hr', val: calculateAverages(history, type, 60) },
            { label: '24 Hr', val: calculateAverages(history, type, 24 * 60) },
            { label: 'All', val: calculateAverages(history, type, 365 * 24 * 60) }
          ].map(h => (
            <div key={h.label}>
              <div style={{ fontSize: '0.75rem', opacity: 0.6, textTransform: 'uppercase', marginBottom: '0.2rem' }}>{h.label} Avg</div>
              <div style={{ fontFamily: 'monospace', fontSize: '1.1rem' }}>{h.val || '-'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function StatsPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<StatHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    const fetchStats = () => fetch('/api/stats').then(res => res.json())
      .then(d => { if (d?.success) setStats(d.data); }).catch(() => {}).finally(() => setLoading(false));
    // The history only gains a point a minute, so don't re-download it every 10 s.
    const fetchHistory = () => fetch('/api/stats-history').then(res => res.json())
      .then(d => { if (d?.success) setHistory(d.history); }).catch(() => {});
    fetchStats();
    fetchHistory();
    const live = setInterval(fetchStats, 10_000);
    const slow = setInterval(fetchHistory, 60_000);
    return () => { clearInterval(live); clearInterval(slow); };
  }, []);

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1>System Node</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.6, fontSize: '0.875rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#48bb78', display: 'inline-block', animation: 'fadeIn 1s infinite alternate' }} />
          Auto-refresh every 10s
        </div>
      </div>

      {loading && !stats ? (
        <p>Connecting to system services...</p>
      ) : stats ? (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(46%, 200px), 1fr))', gap: '0.75rem' }}>
            <StatTile label="Core Temperature" value={stats.temp} history={history} type="temp" />
            <StatTile label="Memory Usage" value={stats.ram.split('/')[0].trim()} sub={`of ${stats.ram.split('/')[1]?.trim() || ''}`} history={history} type="ram" />
            {(() => {
              // "223.0 GB / 252.0 GB (11% Free)" → value "223.0 GB", sub "of 252.0 GB · 11% free", like memory.
              const [usage, free] = stats.storage.split('(');
              const [used, total] = usage.split('/').map((part) => part.trim());
              const freeText = free ? free.replace(')', '').trim().toLowerCase() : '';
              return <StatTile label="Storage Used" value={used} sub={[total && `of ${total}`, freeText].filter(Boolean).join(' · ') || undefined} />;
            })()}
            {stats.cpu !== undefined && (
              <StatTile label="CPU use" value={`${stats.cpu}%`} sub="Current" history={history} type="cpu" />
            )}
            {stats.network && stats.network !== 'N/A' && (() => {
              // "↓ 2.40 Mbit/s | ↑ 310 kbit/s" (live speed) plus traffic since boot.
              const [down, up] = stats.network.split('|').map(s => s.trim());
              return <StatTile label="Network" value={down} sub={[up, stats.networkTotal].filter(Boolean).join(' · ')} />;
            })()}
            {stats.uptime && (() => {
              // "up 3 days, 4 hours, 12 minutes" → "3d 4h" with the full text underneath.
              const short = stats.uptime.replace(/^up /, '').replace(/ days?/, 'd').replace(/ hours?/, 'h').replace(/ minutes?/, 'm').split(', ').slice(0, 2).join(' ');
              return <StatTile label="Uptime" value={short} sub={stats.uptime.replace(/^up /, 'Up ')} />;
            })()}
          </div>

          <div style={{ marginTop: '3rem', textAlign: 'center', opacity: 0.4, fontSize: '0.85rem' }}>
            <p style={{ margin: 0 }}>Host: {stats.platform}</p>
          </div>
        </>
      ) : (
        <p>Failed to load system stats.</p>
      )}
    </div>
  );
}
