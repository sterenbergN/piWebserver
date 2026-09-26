'use client';

import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bodyweightTrend } from '@/lib/workout/session-insights';

type Entry = { id: string; weight: number; date: string };

/** Quick bodyweight logging with a smoothed trend line. Logging also updates the profile weight. */
export default function BodyweightCard({ onWeightChange }: { onWeightChange?: (weight: number) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/workout/bodyweight')
      .then((r) => r.json())
      .then((d) => { if (d.success) setEntries(d.entries); })
      .catch(() => {});
  }, []);

  const trend = bodyweightTrend(entries);
  const chartData = trend.points.slice(-60).map((p) => ({ ...p, label: p.date.slice(5) }));

  const logWeight = async () => {
    const weight = parseFloat(input);
    if (!Number.isFinite(weight)) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/workout/bodyweight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight, date: new Date().toLocaleDateString('en-CA') }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setEntries(data.entries);
      setInput('');
      onWeightChange?.(weight);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save weight.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="workout-tile" style={{ marginTop: '1rem' }}>
      <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Bodyweight</h3>
        {trend.latest && (
          <span style={{ fontSize: '0.85rem' }}>
            <strong>{trend.latest.weight}</strong> lbs
            {trend.change30 !== null && (
              <span className="workout-hint"> · {trend.change30 > 0 ? '+' : ''}{trend.change30} in 30d</span>
            )}
          </span>
        )}
      </div>

      {chartData.length > 1 && (
        <div style={{ height: 110, marginBottom: '0.5rem' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
              <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} axisLine={false} domain={['dataMin - 2', 'dataMax + 2']} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '10px', color: 'var(--foreground)', fontSize: '0.8rem' }}
                formatter={(value, name) => [`${value} lbs`, name === 'average' ? '7-entry average' : 'Logged']}
              />
              <Line type="monotone" dataKey="weight" stroke="var(--muted)" strokeWidth={0} dot={{ r: 2, fill: 'var(--muted)' }} isAnimationActive={false} />
              <Line type="monotone" dataKey="average" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className="workout-input"
          style={{ marginBottom: 0, flex: 1 }}
          type="number"
          inputMode="decimal"
          placeholder={trend.latest ? `lbs today (last ${trend.latest.weight})` : 'lbs today'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') logWeight(); }}
        />
        <button className="btn btn-secondary" style={{ flexShrink: 0 }} disabled={saving || !input} onClick={logWeight}>
          {saving ? 'Saving…' : 'Log'}
        </button>
      </div>
      {error && <p className="workout-error">{error}</p>}
      {entries.length === 0 && <p className="workout-hint" style={{ margin: '0.5rem 0 0' }}>Log your weight a few times a week to see a smoothed trend.</p>}
    </div>
  );
}
