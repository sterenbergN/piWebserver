'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, weekStart, type DateKey } from '@/lib/habits/dates';
import type { QuestionStatus } from '@/lib/daily/grade';
import { TRACK_LABEL, TRACKS } from '@/lib/daily/types';
import type { Progress } from './useDaily';

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);
const STATUS: Record<QuestionStatus, { icon: string; text: string }> = {
  solved: { icon: '✅', text: 'Solved' },
  partial: { icon: '🟡', text: 'Partly right' },
  wrong: { icon: '❌', text: 'Missed' },
  studied: { icon: '📖', text: 'Studied' },
};

type Row = { name: string; me: boolean; xp: number; week: number; streak: number; solved: number };

type Props = { progress: Progress | null; today: DateKey; signedIn: boolean; onOpen: (date: DateKey) => void; onLeaderboard: (on: boolean) => void };

export default function DailyStats({ progress, today, signedIn, onOpen, onLeaderboard }: Props) {
  const [board, setBoard] = useState<Row[] | null>(null);
  useEffect(() => {
    fetch(`/api/daily/leaderboard?today=${today}`, { cache: 'no-store' }).then((r) => r.json()).then((d) => setBoard(d.success ? d.rows : [])).catch(() => setBoard([]));
  }, [today, progress?.leaderboard]);

  // The core question's outcome per day for the last 12 weeks, one column per week.
  const weeks = useMemo(() => {
    const first = addDays(weekStart(today), -11 * 7);
    return Array.from({ length: 12 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  }, [today]);

  if (!progress) return <p className="dq-hint">Loading your stats…</p>;
  const { stats, history } = progress;
  if (!history.length) return <p className="dq-hint">Answer your first question and your stats start here.</p>;

  return (
    <div className="dq-stats">
      <div className="dq-tiles">
        <div className="dq-tile"><span>Streak</span><strong>🔥 {stats.streak.current}</strong><small>best {stats.streak.best} day{stats.streak.best === 1 ? '' : 's'}</small></div>
        <div className="dq-tile"><span>Solved</span><strong>{stats.total.solved}</strong><small>{pct(stats.total.solved, stats.total.answered)} of {stats.total.answered} answered</small></div>
        <div className="dq-tile"><span>Parts right</span><strong>{pct(stats.total.partsRight, stats.total.partsTotal)}</strong><small>{stats.total.partsRight} of {stats.total.partsTotal}</small></div>
        <div className="dq-tile"><span>Question XP</span><strong>{stats.total.xp}</strong><small>{stats.xpThisWeek} this week</small></div>
      </div>

      <section className="dq-panel">
        <h3>Achievements</h3>
        <ul className="dq-achievements">
          {stats.achievements.map((a) => (
            <li key={a.id} className={a.earned ? 'is-earned' : ''} title={a.description}>
              <span className="dq-ach-icon" aria-hidden>{a.icon}</span>
              <strong>{a.title}</strong>
              <small>{a.description}</small>
              {!a.earned && a.progress && (
                <span className="dq-ach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.progress[1]} aria-valuenow={a.progress[0]} aria-label={`${a.title} progress`}>
                  <i style={{ width: `${(a.progress[0] / a.progress[1]) * 100}%` }} />
                </span>
              )}
              <span className="sr-only">{a.earned ? 'Earned' : 'Not earned yet'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dq-panel">
        <h3>By track</h3>
        <div className="dq-track-bars">
          {TRACKS.map((track) => {
            const t = stats.byTrack.find((x) => x.track === track);
            const rate = t && t.answered ? t.solved / t.answered : 0;
            return (
              <div key={track} className={`dq-track-row is-${track}`}>
                <span className="dq-track-name"><i className="dq-dot" aria-hidden /> {TRACK_LABEL[track]}</span>
                <span className="dq-track-bar" aria-hidden><i style={{ width: `${rate * 100}%` }} /></span>
                <span className="dq-track-num">{t && t.answered ? `${pct(t.solved, t.answered)} · ${t.solved}/${t.answered}` : 'none answered yet'}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="dq-panel">
        <h3>XP per week</h3>
        <div className="dq-chart" role="img" aria-label="Question XP per week, last 12 weeks">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.weeks.map((w) => ({ ...w, label: fmtDay(w.week, { month: 'short', day: 'numeric' }) }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--surface-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} allowDecimals={false} width={36} />
              <Tooltip cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }} contentStyle={tooltipStyle} labelFormatter={(l) => `Week of ${l}`} formatter={(v) => [`${v} XP`, '']} separator="" />
              <Bar dataKey="xp" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="dq-panel">
        <h3>Daily question, last 12 weeks</h3>
        <div className="dq-calendar" role="group" aria-label="Daily question results, last 12 weeks">
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((l, i) => <span key={`l${i}`} className="dq-cal-label" aria-hidden>{l}</span>)}
          {weeks.flat().map((d) => {
            if (d > today) return <span key={d} className="dq-cal-cell is-future" aria-hidden />;
            const s = stats.coreByDay[d];
            const text = `${fmtDay(d)}: ${s ? STATUS[s].text : 'not answered'}`;
            return <button key={d} type="button" className={`dq-cal-cell is-${s ?? 'none'}`} title={text} aria-label={text} onClick={() => onOpen(d)} />;
          })}
        </div>
        <div className="dq-legend" aria-hidden>
          <span><i className="dq-cal-cell is-solved" /> Solved</span>
          <span><i className="dq-cal-cell is-partial" /> Partly</span>
          <span><i className="dq-cal-cell is-wrong" /> Missed</span>
          <span><i className="dq-cal-cell is-studied" /> Studied</span>
        </div>
      </section>

      <section className="dq-panel">
        <h3>Topics</h3>
        <div className="dq-table-wrap">
          <table className="dq-table">
            <thead><tr><th scope="col">Topic</th><th scope="col">Answered</th><th scope="col">Solved</th><th scope="col">Rate</th></tr></thead>
            <tbody>
              {stats.byTopic.map((t) => (
                <tr key={`${t.track}/${t.topic}`} className={`is-${t.track}`}>
                  <th scope="row"><i className="dq-dot" aria-hidden /> {t.topic} <small>{TRACK_LABEL[t.track]}</small></th>
                  <td>{t.answered}</td><td>{t.solved}</td><td>{pct(t.solved, t.answered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dq-panel">
        <h3>History</h3>
        <ul className="dq-history">
          {history.slice(0, 60).map((a) => (
            <li key={a.questionId}>
              <button type="button" onClick={() => onOpen(a.date)}>
                <span className="dq-history-date">{fmtDay(a.date, { month: 'short', day: 'numeric' })}</span>
                <span className="dq-history-title">
                  {a.meta.core ? '' : '🎁 '}{a.meta.title}
                  <small>{TRACK_LABEL[a.meta.track]} · {a.meta.topic}{a.regraded ? ' · 🔁 regraded' : ''}</small>
                </span>
                <span className="dq-history-status" title={STATUS[a.status].text}>{STATUS[a.status].icon}<span className="sr-only">{STATUS[a.status].text}</span></span>
                <span className="dq-history-xp">+{a.xp}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="dq-panel">
        <h3>Leaderboard</h3>
        {signedIn ? (
          <label className="dq-check">
            <input type="checkbox" checked={progress.leaderboard} onChange={(e) => onLeaderboard(e.target.checked)} />
            <span>Show me on the leaderboard (your username, XP and streak)</span>
          </label>
        ) : <p className="dq-hint">Sign in to join the leaderboard.</p>}
        {board && board.length > 0 ? (
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">This week</th><th scope="col">All time</th><th scope="col">Streak</th></tr></thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.name} className={r.me ? 'is-me' : ''}>
                    <td>{i + 1}</td><th scope="row">{r.name}{r.me ? ' (you)' : ''}</th><td>{r.week}</td><td>{r.xp}</td><td>🔥 {r.streak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="dq-hint">Nobody has joined yet.</p>}
      </section>
    </div>
  );
}
