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

const StatTile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="glass-panel" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
    <h3 style={{ color: 'var(--accent-light)', marginBottom: '0.75rem', fontSize: '0.95rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</h3>
    <p style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--foreground)' }}>{value}</p>
    {sub && <p style={{ fontSize: '0.9rem', marginTop: '0.25rem', opacity: 0.6, marginBottom: 0 }}>{sub}</p>}
  </div>
);

export default function StatsPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = () => {
    setLoading(true);
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => {
        if (data?.success) setStats(data.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
            <StatTile label="Core Temperature" value={stats.temp} />
            <StatTile label="Memory Usage" value={stats.ram.split('/')[0].trim()} sub={`of ${stats.ram.split('/')[1]?.trim() || ''}`} />
            <StatTile label="Storage Used" value={stats.storage.split('(')[0].trim()} sub={stats.storage.includes('(') ? `(${stats.storage.split('(')[1]}` : undefined} />
            {stats.cpu !== undefined && (
              <StatTile label="CPU Load" value={`${stats.cpu}%`} sub="1-min avg" />
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
