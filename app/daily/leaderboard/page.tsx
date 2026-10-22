'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { localToday } from '@/lib/habits/dates';
import '../daily.css';
import './leaderboard.css';

type Row = {
  name: string; me: boolean;
  /** Question XP all time and this week, streak and solved count. */
  xp: number; week: number; streak: number; solved: number;
  habits: { xp: number; streak: number };
  chores: { xp: number; week: number };
  total: number; level: number; title: string;
};
type Board = 'overall' | 'questions' | 'habits' | 'chores';
type Period = 'week' | 'all';

const BOARDS: { id: Board; icon: string; label: string; note: string; periods: boolean }[] = [
  { id: 'overall', icon: '⭐', label: 'Overall', note: 'Level and XP from questions, habits and chores together.', periods: false },
  { id: 'questions', icon: '🧠', label: 'Questions', note: 'XP from daily questions and practice.', periods: true },
  { id: 'habits', icon: '✅', label: 'Habits', note: 'XP from habits, with the current run of perfect days.', periods: false },
  { id: 'chores', icon: '🧹', label: 'Chores', note: 'XP from chores you’ve done.', periods: true },
];
const MEDALS = ['🥇', '🥈', '🥉'];

/** What a row scores on a board, and the line under the name. */
function score(r: Row, board: Board, period: Period): { value: number; sub: string } {
  if (board === 'overall') return { value: r.total, sub: `Lv ${r.level} · ${r.title}` };
  if (board === 'questions') return { value: period === 'week' ? r.week : r.xp, sub: `🔥 ${r.streak} day streak · ${r.solved} solved` };
  if (board === 'habits') return { value: r.habits.xp, sub: `🔥 ${r.habits.streak} perfect day${r.habits.streak === 1 ? '' : 's'} in a row` };
  return { value: period === 'week' ? r.chores.week : r.chores.xp, sub: period === 'week' ? `${r.chores.xp.toLocaleString()} XP all time` : `${r.chores.week.toLocaleString()} XP this week` };
}

/** Leaderboards for the daily parts of the site: overall level, questions, habits and chores. */
export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [board, setBoard] = useState<Board>('overall');
  const [period, setPeriod] = useState<Period>('week');
  /** Whether you're on the leaderboard; null when signed out (or still loading). */
  const [joined, setJoined] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const today = localToday();

  // The open board lives in the URL (#habits) so it can be linked to.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (BOARDS.some((b) => b.id === id)) setBoard(id as Board);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const choose = (id: Board) => { setBoard(id); history.replaceState(history.state, '', `#${id}`); };

  const load = () => fetch(`/api/daily/leaderboard?today=${today}`, { cache: 'no-store' }).then((r) => r.json())
    .then((d) => { if (!d.success) throw new Error(); setRows(d.rows); })
    .catch(() => setError('Couldn’t load the leaderboard.'));
  useEffect(() => {
    load();
    fetch(`/api/daily/progress?today=${today}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d) => setJoined(d?.success ? !!d.leaderboard : null)).catch(() => setJoined(null));
  }, []);

  const join = async (on: boolean) => {
    setSaving(true);
    try {
      const res = await fetch('/api/daily/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leaderboard', on }) });
      const d = await res.json();
      if (!d.success) throw new Error();
      setJoined(d.leaderboard);
      await load();
    } catch {
      setError('Couldn’t change that.');
    } finally {
      setSaving(false);
    }
  };

  const info = BOARDS.find((b) => b.id === board)!;
  const ranked = (rows ?? []).map((r) => ({ row: r, ...score(r, board, period) })).sort((a, b) => b.value - a.value || a.row.name.localeCompare(b.row.name));
  // Ties share a place.
  const places = ranked.map((r, i) => (i > 0 && r.value === ranked[i - 1].value ? null : i + 1));
  for (let i = 1; i < places.length; i++) if (places[i] === null) places[i] = places[i - 1];

  return (
    <div className="dq lb animate-fade-in">
      <header className="dq-head">
        <div>
          <h1>🏆 Leaderboard</h1>
          <p>Who’s ahead on questions, habits and chores.</p>
        </div>
        <Link className="dq-text-btn lb-back" href="/daily#stats">← Your stats</Link>
      </header>

      <div className="lb-boards" role="tablist" aria-label="Leaderboards">
        {BOARDS.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={board === b.id} onClick={() => choose(b.id)}>
            <span aria-hidden>{b.icon}</span> {b.label}
          </button>
        ))}
      </div>

      <div className="lb-sub">
        <p className="dq-hint">{info.note}</p>
        {info.periods && (
          <div className="dq-seg lb-period" role="radiogroup" aria-label="Period">
            <button type="button" role="radio" aria-checked={period === 'week'} onClick={() => setPeriod('week')}>This week</button>
            <button type="button" role="radio" aria-checked={period === 'all'} onClick={() => setPeriod('all')}>All time</button>
          </div>
        )}
      </div>

      {error && <div className="dq-banner is-error" role="alert"><span>{error}</span><button type="button" className="dq-small-btn" onClick={() => setError('')}>OK</button></div>}

      {!rows ? <p className="dq-hint">Loading…</p> : ranked.length === 0 ? (
        <p className="dq-hint lb-empty">Nobody has joined the leaderboard yet.</p>
      ) : (
        <ol className="lb-list">
          {ranked.map(({ row, value, sub }, i) => {
            const place = places[i]!;
            return (
              <li key={row.name} className={`${row.me ? 'is-me' : ''}${place <= 3 && value > 0 ? ` is-top is-top-${place}` : ''}`}>
                <span className="lb-place" aria-label={`Place ${place}`}>{place <= 3 && value > 0 ? MEDALS[place - 1] : place}</span>
                <span className="lb-name">
                  <strong>{row.name}{row.me && <span className="lb-you">You</span>}</strong>
                  <small>{sub}</small>
                </span>
                <span className="lb-value"><strong>{value.toLocaleString()}</strong><small>XP</small></span>
              </li>
            );
          })}
        </ol>
      )}

      <section className="dq-panel lb-join">
        {joined === null ? (
          <p className="dq-hint" style={{ margin: 0 }}>Sign in to join the leaderboard.</p>
        ) : (
          <label className="dq-check">
            <input type="checkbox" checked={joined} disabled={saving} onChange={(e) => join(e.target.checked)} />
            <span>Show me on the leaderboard (your username, level, and XP and streaks from questions, habits and chores)</span>
          </label>
        )}
      </section>
    </div>
  );
}
