'use client';

import { useState, useEffect } from 'react';

interface SystemStats {
  platform: string;
  temp: string;
  ram: string;
  storage: string;
  uptime?: string;
  cpu?: string;
}

interface StatHistory {
  timestamp: string;
  temp: number;
  ramUsage: number;
  cpuLoad: number;
}

type StatType = 'temp' | 'ram' | 'cpu';

const calculateAverages = (history: StatHistory[], type: StatType, mins: number) => {
  if (!history || history.length === 0) return null;
  const cutoff = new Date(Date.now() - mins * 60000).getTime();
  const relevant = history.filter(h => new Date(h.timestamp).getTime() > cutoff);
  if (relevant.length === 0) return null;
  
  if (type === 'temp') return (relevant.reduce((acc, curr) => acc + curr.temp, 0) / relevant.length).toFixed(1) + '°C';
  if (type === 'cpu') return (relevant.reduce((acc, curr) => acc + curr.cpuLoad, 0) / relevant.length).toFixed(1) + '%';
  if (type === 'ram') return (relevant.reduce((acc, curr) => acc + curr.ramUsage, 0) / relevant.length).toFixed(1) + '%';
  return null;
};

const StatTile = ({ label, value, sub, history, type }: { label: string; value: string; sub?: string; history?: StatHistory[]; type?: StatType }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-panel" 
      onClick={() => history && type && setExpanded(!expanded)}
      style={{ textAlign: 'center', padding: '2.5rem 1.5rem', cursor: history && type ? 'pointer' : 'default', transition: 'all 0.2s ease', position: 'relative' }}>
      
      {history && type && (
        <div style={{ position: 'absolute', top: '10px', right: '12px', opacity: 0.4, fontSize: '0.8rem' }}>
          {expanded ? '▲' : '▼'}
        </div>
      )}

      <h3 style={{ color: 'var(--accent-light)', marginBottom: '0.75rem', fontSize: '0.95rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</h3>
      <p style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--foreground)' }}>{value}</p>
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

  const fetchStats = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/stats').then(res => res.json()),
      fetch('/api/stats-history').then(res => res.json())
    ]).then(([statsData, historyData]) => {
      if (statsData?.success) setStats(statsData.data);
      if (historyData?.success) setHistory(historyData.history);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
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
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
            <StatTile label="Core Temperature" value={stats.temp} history={history} type="temp" />
            <StatTile label="Memory Usage" value={stats.ram.split('/')[0].trim()} sub={`of ${stats.ram.split('/')[1]?.trim() || ''}`} history={history} type="ram" />
            <StatTile label="Storage Used" value={stats.storage.split('(')[0].trim()} sub={stats.storage.includes('(') ? `(${stats.storage.split('(')[1]}` : undefined} />
            {stats.cpu !== undefined && (
              <StatTile label="CPU Load" value={`${stats.cpu}%`} sub="Current" history={history} type="cpu" />
            )}
            {stats.uptime && (
              <StatTile label="Uptime" value="" sub={stats.uptime} />
            )}
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
