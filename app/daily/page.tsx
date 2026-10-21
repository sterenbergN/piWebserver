'use client';

import { useEffect, useRef, useState } from 'react';
import QuestionCard from '@/components/daily/QuestionCard';
import FormulaSheet, { FormulaOfTheDay } from '@/components/daily/FormulaSheet';
import DailyStats from '@/components/daily/DailyStats';
import { useDaily } from '@/components/daily/useDaily';
import Confetti from '@/components/habits/Confetti';
import { choresXpElsewhere, habitsXpElsewhere } from '@/components/progress/otherXp';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { levelFromXp } from '@/lib/progress/levels';
import { TRACK_LABEL } from '@/lib/daily/types';
import type { PartResponse } from '@/lib/daily/types';
import 'katex/dist/katex.min.css';
import './daily.css';

const TABS = [
  { id: 'today', icon: '🧠', label: 'Questions' },
  { id: 'archive', icon: '🗂️', label: 'Archive' },
  { id: 'stats', icon: '📈', label: 'Stats' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

export default function DailyPage() {
  const d = useDaily();
  const [tab, setTab] = useState<TabId>('today');
  const [habitXp, setHabitXp] = useState(0);
  const [confetti, setConfetti] = useState(0);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (TABS.some((t) => t.id === id)) setTab(id as TabId);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const chooseTab = (id: TabId) => { setTab(id); history.replaceState(history.state, '', `#${id}`); };

  // The profile level also counts habits and chores.
  useEffect(() => { if (d.state === 'ready') Promise.all([habitsXpElsewhere(), choresXpElsewhere()]).then(([a, b]) => setHabitXp(a + b)); }, [d.state, d.signedIn]);

  const questionXp = d.progress?.stats.total.xp ?? 0;
  const level = levelFromXp(questionXp + habitXp);
  const streak = d.progress?.stats.streak;

  // Celebrate a level up (not what was already true when the page opened).
  const seenLevel = useRef<number | null>(null);
  useEffect(() => {
    if (!d.progress) return;
    if (seenLevel.current !== null && level.level > seenLevel.current) {
      setConfetti(Date.now());
      setToast(`Level ${level.level}! You’re a ${level.title.toLowerCase()} now.`);
    }
    seenLevel.current = level.level;
  }, [level.level, level.title, d.progress]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  const answer = async (questionId: string, responses: Record<string, PartResponse> | null, hints: number, isCore: boolean) => {
    const alreadyCounted = d.progress?.stats.streak.doneToday;
    await d.submit(questionId, responses, hints);
    vibrate(30);
    // Today's core question, the first time: the streak goes up.
    if (isCore && d.date === d.today && !alreadyCounted) {
      const next = (streak?.current ?? 0) + 1;
      setToast(`🔥 Streak: ${next} day${next === 1 ? '' : 's'}!`);
    }
  };

  // Confetti when a question comes back fully solved.
  const solvedCount = Object.values(d.answered).filter((a) => a.status === 'solved').length;
  const seenSolved = useRef<{ date: string | null; count: number }>({ date: null, count: 0 });
  useEffect(() => {
    const seen = seenSolved.current;
    if (seen.date === d.date && solvedCount > seen.count) setConfetti(Date.now());
    seenSolved.current = { date: d.date, count: solvedCount };
  }, [solvedCount, d.date]);

  const isPast = !!d.date && d.date < d.today;
  const signIn = () => window.dispatchEvent(new Event('site:sign-in'));
  const openDay = (date: DateKey) => { d.open(date); chooseTab('today'); window.scrollTo({ top: 0 }); };
  const statusFor = (date: DateKey) => d.progress?.stats.coreByDay[date];

  return (
    <div className="dq animate-fade-in">
      <Confetti fire={confetti} />

      <header className="dq-head">
        <div>
          <h1>Daily questions</h1>
          <p>One engineering question a day: mechanical, controls and automation.</p>
        </div>
        {d.state === 'ready' && (
          <div className="dq-level" title={`${level.xp} XP total (questions and habits)`}>
            <span className="dq-level-badge">Lv {level.level}</span>
            <div className="dq-level-text">
              <strong>{level.title}</strong>
              <div className="dq-level-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={level.size} aria-valuenow={level.into}>
                <span style={{ width: `${(level.into / level.size) * 100}%` }} />
              </div>
              <small>{level.into} / {level.size} XP · 🔥 {streak?.current ?? 0} day streak</small>
            </div>
          </div>
        )}
      </header>

      {d.state === 'ready' && !d.signedIn && (
        <div className="dq-banner">
          <span>Answers are kept on this device only.</span>
          <button type="button" className="dq-small-btn" onClick={signIn}>Sign in to keep your streak</button>
        </div>
      )}
      {d.deviceCount > 0 && (
        <div className="dq-banner">
          <span>{d.deviceCount} answer{d.deviceCount === 1 ? ' is' : 's are'} saved on this device from before you signed in.</span>
          <button type="button" className="dq-small-btn is-primary" onClick={d.importDevice}>Add to my account</button>
          <button type="button" className="dq-small-btn" onClick={d.dismissDevice}>Discard</button>
        </div>
      )}
      {d.error && (
        <div className="dq-banner is-error" role="alert">
          <span>{d.error}</span>
          <button type="button" className="dq-small-btn" onClick={d.clearError}>OK</button>
        </div>
      )}

      {d.state === 'loading' && <p className="dq-hint">Loading today’s question…</p>}
      {d.state === 'error' && (
        <div className="dq-banner is-error">
          <span>Couldn’t load the questions.</span>
          <button type="button" className="dq-small-btn" onClick={d.reload}>Try again</button>
        </div>
      )}

      {d.state === 'ready' && (
        <>
          <div className="dq-tabs" role="tablist" aria-label="Daily questions">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => chooseTab(t.id)}>
                <span aria-hidden>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          {tab === 'today' && (
            <>
              <div className="dq-day-head">
                {d.date && (
                  <button type="button" className="dq-icon-btn" aria-label="Previous day" onClick={() => openDay(addDays(d.date!, -1))}>‹</button>
                )}
                <div className="dq-day-title">
                  <h2>{d.date === d.today ? 'Today' : d.date === addDays(d.today, -1) ? 'Yesterday' : d.date ? fmtDay(d.date, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</h2>
                  {d.date && <span className="dq-hint">{fmtDay(d.date)}</span>}
                </div>
                <button type="button" className="dq-icon-btn" aria-label="Next day" disabled={!d.date || d.date >= d.today} onClick={() => openDay(addDays(d.date!, 1))}>›</button>
              </div>
              {isPast && (
                <p className="dq-catchup">
                  Catching up on an earlier day: half XP, and it doesn’t change your streak.{' '}
                  <button type="button" className="dq-text-btn" onClick={() => openDay(d.today)}>Back to today</button>
                </p>
              )}

              {!d.day ? (
                <section className="dq-empty">
                  <h2>No question {isPast ? 'for this day' : 'today yet'}</h2>
                  <p className="dq-hint">{d.archive.length ? 'Try one from the archive in the meantime.' : 'Questions haven’t been loaded yet. Check back soon.'}</p>
                  {d.archive.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => chooseTab('archive')}>Open the archive</button>}
                </section>
              ) : (
                <>
                  {d.day.formulaOfTheDay && <FormulaOfTheDay formula={d.day.formulaOfTheDay} />}
                  <FormulaSheet formulas={d.day.formulas} />
                  <QuestionCard key={d.day.core.id} q={d.day.core} kind="core" boss={!!d.day.boss} late={isPast} answered={d.answered[d.day.core.id]}
                    formulas={d.day.formulas} signedIn={d.signedIn}
                    onAnswer={(r, h) => answer(d.day!.core.id, r, h, true)} onReveal={(h) => answer(d.day!.core.id, null, h, true)}
                    onFeedback={(p) => d.feedback(d.day!.core.id, p)} />
                  {d.day.bonus.length > 0 && (
                    <>
                      <h2 className="dq-section">Bonus questions <span className="dq-hint">optional, for extra XP</span></h2>
                      {d.day.bonus.map((q) => (
                        <QuestionCard key={q.id} q={q} kind="bonus" boss={false} late={isPast} answered={d.answered[q.id]}
                          formulas={d.day!.formulas} signedIn={d.signedIn}
                          onAnswer={(r, h) => answer(q.id, r, h, false)} onReveal={(h) => answer(q.id, null, h, false)}
                          onFeedback={(p) => d.feedback(q.id, p)} />
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'archive' && (
            d.archive.length === 0 ? <p className="dq-hint">No past questions yet.</p> : (
              <ul className="dq-archive">
                {d.archive.map((a) => {
                  const s = statusFor(a.date);
                  return (
                    <li key={a.date}>
                      <button type="button" className={`is-${a.track}`} onClick={() => openDay(a.date)}>
                        <span className="dq-archive-date">{fmtDay(a.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        <span className="dq-archive-title">
                          {a.boss ? '👹 ' : ''}{a.title}
                          <small><i className="dq-dot" aria-hidden /> {TRACK_LABEL[a.track]} · {a.topic}</small>
                        </span>
                        <span className="dq-archive-status">
                          {s === 'solved' ? '✅' : s === 'partial' ? '🟡' : s === 'wrong' ? '❌' : s === 'studied' ? '📖' : <span className="dq-hint">Not done</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {tab === 'stats' && <DailyStats progress={d.progress} today={d.today} signedIn={d.signedIn} onOpen={openDay} onLeaderboard={d.setLeaderboard} />}
        </>
      )}

      {toast && <div className="dq-toast" role="status">{toast}</div>}
    </div>
  );
}
