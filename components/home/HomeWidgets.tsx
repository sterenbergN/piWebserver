'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { deviceProgress, readDeviceAttempts } from '@/components/daily/useDaily';
import { choresXpElsewhere } from '@/components/progress/otherXp';
import { localToday } from '@/lib/habits/dates';
import { isActive, normalizeHabitsData, type HabitsData } from '@/lib/habits/habits';
import { habitXp, isDueOn, isWeekly } from '@/lib/habits/stats';
import { levelFromXp } from '@/lib/progress/levels';
import { formatRelativeDay, trainingStreak } from '@/lib/workout/session-insights';
import type { QuestionStatus } from '@/lib/daily/grade';
import { TRACK_LABEL, type Track } from '@/lib/daily/types';

type DailyState = {
  question: { title: string; track: Track; status: QuestionStatus | null } | null;
  streak: number;
  habits: { done: number; due: number };
  level: ReturnType<typeof levelFromXp>;
};
type FitnessState = { signedIn: boolean; thisWeek: number; weekStreak: number; last: { name: string; when: string } | null };

const STATUS: Record<QuestionStatus, string> = { solved: '✅ Solved', partial: '🟡 Partly right', wrong: '❌ Answered', studied: '📖 Studied' };

async function loadHabits(today: string): Promise<{ data: HabitsData; signedIn: boolean }> {
  const res = await fetch(`/api/habits?today=${today}`, { cache: 'no-store' }).catch(() => null);
  if (res?.ok) {
    const body = await res.json();
    return { data: normalizeHabitsData(body.data, today), signedIn: true };
  }
  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem('habits:device') || 'null'); } catch { /* nothing kept */ }
  return { data: normalizeHabitsData(stored, today), signedIn: false };
}

async function loadDaily(today: string): Promise<{ daily: DailyState; signedIn: boolean }> {
  const [{ data: habits, signedIn }, day, chores] = await Promise.all([
    loadHabits(today),
    fetch(`/api/daily?today=${today}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    choresXpElsewhere(),
  ]);
  const core = day?.day?.core;
  let status: QuestionStatus | null = core ? day.answered?.[core.id]?.status ?? null : null;
  let progress = { streak: 0, xp: 0 };
  if (day?.signedIn) {
    const p = await fetch(`/api/daily/progress?today=${today}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (p?.success) progress = { streak: p.stats.streak.current, xp: p.stats.total.xp };
  } else {
    const p = deviceProgress(today);
    progress = { streak: p.stats.streak.current, xp: p.stats.total.xp };
    if (core) status = readDeviceAttempts().find((a) => a.questionId === core.id)?.result.status ?? null;
  }
  const due = habits.habits.filter((h) => isActive(h) && !isWeekly(h) && isDueOn(h, today));
  return {
    signedIn,
    daily: {
      question: core ? { title: core.title, track: core.track, status } : null,
      streak: progress.streak,
      habits: { due: due.length, done: due.filter((h) => (habits.log[today]?.[h.id] ?? 0) >= h.target).length },
      level: levelFromXp(progress.xp + habitXp(habits, today) + chores),
    },
  };
}

/**
 * The two parts of the site used every day, as widgets at the top of the home
 * page: the daily question, habits and level, and where workouts stand.
 */
export default function HomeWidgets() {
  const [daily, setDaily] = useState<DailyState | null>(null);
  const [fitness, setFitness] = useState<FitnessState | null>(null);

  useEffect(() => {
    const today = localToday();
    let cancelled = false;
    loadDaily(today).then(async ({ daily: d, signedIn }) => {
      if (cancelled) return;
      setDaily(d);
      if (!signedIn) { setFitness({ signedIn: false, thisWeek: 0, weekStreak: 0, last: null }); return; }
      const body = await fetch('/api/workout/history', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      const history: { name?: string; timestamp?: string }[] = Array.isArray(body?.history) ? body.history : [];
      const streak = trainingStreak(history);
      const last = [...history].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
      setFitness({ signedIn: true, thisWeek: streak.workoutsThisWeek, weekStreak: streak.weekStreak, last: last ? { name: last.name || 'Workout', when: formatRelativeDay(last.timestamp) } : null });
    }).catch(() => { if (!cancelled) { setDaily(null); setFitness(null); } });
    return () => { cancelled = true; };
  }, []);

  const q = daily?.question;
  return (
    <section className="home-widgets" aria-label="Daily and fitness">
      <article className="home-widget is-daily">
        <header className="home-widget-head">
          <span className="home-widget-icon" aria-hidden>☀️</span>
          <h2><Link href="/today" className="home-widget-link">Daily</Link></h2>
          {daily && <span className="home-widget-level" title={`${daily.level.xp} XP`}>Lv {daily.level.level} · {daily.level.title}</span>}
        </header>
        <div className="home-widget-main">
          <small>Today’s question</small>
          <strong>{daily ? (q ? q.title : 'No question today yet') : '…'}</strong>
          {q && <span className="home-widget-sub">{TRACK_LABEL[q.track]} · {q.status ? STATUS[q.status] : 'Not answered yet'}</span>}
        </div>
        <dl className="home-widget-stats">
          <div><dt>Question streak</dt><dd>🔥 {daily?.streak ?? '–'}</dd></div>
          <div><dt>Habits today</dt><dd>{daily ? (daily.habits.due ? `${daily.habits.done} / ${daily.habits.due}` : 'None due') : '–'}</dd></div>
        </dl>
        <nav className="home-widget-chips" aria-label="Daily pages">
          <Link href="/daily">🧠 Questions</Link>
          <Link href="/habits">✅ Habits</Link>
          <Link href="/chores">🧹 Chores</Link>
          <Link href="/daily/leaderboard">🏆 Leaderboard</Link>
        </nav>
      </article>

      <article className="home-widget is-fitness">
        <header className="home-widget-head">
          <span className="home-widget-icon" aria-hidden>🏋️</span>
          <h2><Link href="/workout" className="home-widget-link">Fitness</Link></h2>
        </header>
        <div className="home-widget-main">
          <small>{fitness?.signedIn ? 'Last workout' : 'Workout tracker'}</small>
          <strong>{!fitness ? '…' : !fitness.signedIn ? 'Plan, log and track your lifts' : fitness.last ? fitness.last.name : 'No workouts yet'}</strong>
          {fitness?.last && <span className="home-widget-sub">{fitness.last.when}</span>}
          {fitness && !fitness.signedIn && <span className="home-widget-sub">Sign in to keep your training history</span>}
        </div>
        <dl className="home-widget-stats">
          <div><dt>This week</dt><dd>{fitness?.signedIn ? `${fitness.thisWeek} workout${fitness.thisWeek === 1 ? '' : 's'}` : '–'}</dd></div>
          <div><dt>Week streak</dt><dd>{fitness?.signedIn ? `🔥 ${fitness.weekStreak}` : '–'}</dd></div>
        </dl>
        <nav className="home-widget-chips" aria-label="Fitness pages">
          <Link href="/workout">▶ Start a workout</Link>
          <Link href="/workout/health">❤️ Health</Link>
          <Link href="/workout/analytics">📈 Progress</Link>
        </nav>
      </article>
    </section>
  );
}
