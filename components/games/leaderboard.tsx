'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameId } from '@/lib/games/registry';

export type LeaderboardEntry = { name: string; score: number; date: string };

const NAME_KEY = 'arcadeName';
let accountName: Promise<string | null> | null = null;

/**
 * The name to put on a high score: your account's username when signed in,
 * else the name you used last time on this device. Empty until known.
 */
export function usePlayerName() {
  const [name, setName] = useState('');
  useEffect(() => {
    let cancelled = false;
    try { const saved = localStorage.getItem(NAME_KEY); if (saved) setName(saved); } catch { /* storage blocked */ }
    accountName ??= fetch('/api/workout/auth', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.authenticated && typeof d.user?.username === 'string' ? d.user.username.slice(0, 20) : null))
      .catch(() => null);
    accountName.then((n) => { if (n && !cancelled) setName(n); });
    return () => { cancelled = true; };
  }, []);
  return name;
}

function rememberName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* storage blocked */ }
}

/** Load and submit to one game's global top-10. */
export function useLeaderboard(game: GameId) {
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
      rememberName(name.trim());
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

/**
 * The "new high score" form on a game-over screen. The name starts as your
 * account name (or the last one used here) and can be changed before saving.
 */
export function ScoreForm({ score, submitting, error, onSubmit, onSkip }: {
  score: number;
  submitting: boolean;
  error: string;
  onSubmit: (name: string) => void;
  onSkip: () => void;
}) {
  const known = usePlayerName();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? known;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!submitting && value.trim()) onSubmit(value.trim()); }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '85%', maxWidth: 280, background: 'rgba(0,0,0,0.5)', padding: '1.1rem', borderRadius: 12 }}
    >
      <p style={{ color: 'var(--accent-light)', textAlign: 'center', fontWeight: 700, margin: 0 }}>New high score! {score.toLocaleString()}</p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', color: '#ddd', fontSize: '0.8rem' }}>
        Name on the leaderboard
        <input name="playername" placeholder="Your name" required maxLength={20} autoFocus={!known} disabled={submitting}
          value={value} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()}
          style={{ padding: '0.7rem', borderRadius: 8, border: '1px solid var(--accent)', background: 'transparent', color: '#fff', textAlign: 'center', fontSize: '1.05rem' }} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={submitting || !value.trim()} autoFocus={!!known}>{submitting ? 'Saving…' : 'Submit score'}</button>
      {error && <p style={{ color: '#fc8181', fontSize: '0.8rem', margin: 0, textAlign: 'center' }}>{error}</p>}
      <button type="button" className="btn btn-secondary" onClick={onSkip}>Skip</button>
    </form>
  );
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
