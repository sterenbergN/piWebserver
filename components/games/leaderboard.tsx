'use client';

import { useCallback, useEffect, useState } from 'react';

export type LeaderboardEntry = { name: string; score: number; date: string };

/** Load and submit to one game's global top-10. */
export function useLeaderboard(game: 'snake' | '2048') {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/leaderboard?game=${game}`).then((r) => r.json()).then((d) => { if (d.success) setLeaderboard(d.leaderboard); }).catch(() => {});
  }, [game]);

  const qualifies = useCallback((score: number) =>
    score > 0 && (leaderboard.length < 10 || score > (leaderboard[leaderboard.length - 1]?.score || 0)), [leaderboard]);

  const submit = useCallback(async (name: string, score: number) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game, name, score }) });
      const data = await res.json();
      if (!data.success) { setError(data.message || 'Could not save score.'); return false; }
      setLeaderboard(data.leaderboard);
      return true;
    } catch {
      setError('Network error — score not saved.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [game]);

  return { leaderboard, qualifies, submit, submitting, error, setError };
}

export function LeaderboardPanel({ title, entries, empty }: { title: string; entries: LeaderboardEntry[]; empty: React.ReactNode }) {
  return (
    <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', alignSelf: 'flex-start', display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--accent-light)' }}>{title}</h2>
      {entries.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, minHeight: '200px' }}>
          <p style={{ textAlign: 'center' }}>{empty}</p>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
          {entries.map((entry, idx) => (
            <li key={`${entry.name}-${entry.date}-${idx}`} className="animate-fade-in" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: idx === 0 ? 'rgba(255, 215, 0, 0.1)' : idx === 1 ? 'rgba(192, 192, 192, 0.1)' : idx === 2 ? 'rgba(205, 127, 50, 0.1)' : 'var(--surface-glass)',
              padding: '1rem 1.25rem', borderRadius: '12px',
              borderLeft: idx === 0 ? '4px solid #ffd700' : idx === 1 ? '4px solid #c0c0c0' : idx === 2 ? '4px solid #cd7f32' : '4px solid transparent',
              animationDelay: `${idx * 0.1}s`,
            }}>
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', minWidth: 0 }}>
                <span style={{ fontWeight: 'bold', width: '20px', textAlign: 'right', color: 'var(--accent-light)', opacity: 0.7 }}>{(idx + 1).toString().padStart(2, '0')}</span>
                <span style={{ fontWeight: '600', fontSize: '1.1rem', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--accent)' }}>{entry.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
