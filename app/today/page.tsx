'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import HabitCard from '@/components/habits/HabitCard';
import ChoreCard from '@/components/chores/ChoreCard';
import { useChores } from '@/components/chores/useChores';
import { useHabits } from '@/components/habits/useHabits';
import { deviceProgress, readDeviceAttempts } from '@/components/daily/useDaily';
import { isActive } from '@/lib/habits/habits';
import { freezeState, habitMeta, habitXp, isDueOn, isWeekly } from '@/lib/habits/stats';
import { levelFromXp } from '@/lib/progress/levels';
import { isOpen as choreOpen } from '@/lib/chores/chores';
import { byUrgency, choreXp, dueStatus } from '@/lib/chores/stats';
import { formatRelativeDay, trainingStreak } from '@/lib/workout/session-insights';
import type { PublicDay, QuestionStatus } from '@/lib/daily/grade';
import { TRACK_LABEL } from '@/lib/daily/types';
import '../habits/habits.css';
import '../chores/chores.css';
import './today.css';

type QuestionState = { day: PublicDay | null; status: QuestionStatus | null; streak: number; doneToday: boolean; xp: number };
type WorkoutState = { thisWeek: number; weekStreak: number; last: { name: string; when: string } | null };

const STATUS: Record<QuestionStatus, string> = { solved: '✅ Solved', partial: '🟡 Partly right', wrong: '❌ Answered', studied: '📖 Studied' };

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** One page for the day: the question, the habits to tick off, chores that are due, and where workouts stand. */
export default function TodayPage() {
  const h = useHabits();
  const { data, today } = h;
  const ch = useChores();
  const me = ch.household?.me ?? null;
  const signedIn = h.mode === 'account';
  const [question, setQuestion] = useState<QuestionState | null>(null);
  const [workout, setWorkout] = useState<WorkoutState | null>(null);

  // Today's question, and how the question streak stands.
  useEffect(() => {
    if (h.mode !== 'account' && h.mode !== 'device') return;
    let cancelled = false;
    (async () => {
      try {
        const body = await fetch(`/api/daily?today=${today}`, { cache: 'no-store' }).then((r) => r.json());
        const day: PublicDay | null = body.day ?? null;
        let status: QuestionStatus | null = day ? body.answered?.[day.core.id]?.status ?? null : null;
        let progress = { streak: 0, doneToday: false, xp: 0 };
        if (body.signedIn) {
          const p = await fetch(`/api/daily/progress?today=${today}`, { cache: 'no-store' }).then((r) => r.json());
          if (p.success) progress = { streak: p.stats.streak.current, doneToday: p.stats.streak.doneToday, xp: p.stats.total.xp };
        } else {
          const p = deviceProgress(today);
          progress = { streak: p.stats.streak.current, doneToday: p.stats.streak.doneToday, xp: p.stats.total.xp };
          if (day) status = readDeviceAttempts().find((a) => a.questionId === day.core.id)?.result.status ?? null;
        }
        if (!cancelled) setQuestion({ day, status, ...progress });
      } catch {
        if (!cancelled) setQuestion({ day: null, status: null, streak: 0, doneToday: false, xp: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [h.mode, today]);

  // Workouts (signed in only; signed out the tracker is a demo).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch('/api/workout/history', { cache: 'no-store' }).then((r) => r.json()).then((body) => {
      if (cancelled || !Array.isArray(body.history)) return;
      const streak = trainingStreak(body.history);
      const last = [...body.history].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
      setWorkout({ thisWeek: streak.workoutsThisWeek, weekStreak: streak.weekStreak, last: last ? { name: last.name || 'Workout', when: formatRelativeDay(last.timestamp) } : null });
    }).catch(() => { /* the card just stays empty */ });
    return () => { cancelled = true; };
  }, [signedIn]);

  const frozen = useMemo(() => freezeState(data, today).frozen, [data, today]);
  const level = levelFromXp(habitXp(data, today) + (question?.xp ?? 0) + choreXp(ch.data, me));
  // Chores that need doing now: overdue or due today (yours or anyone's).
  const openChores = ch.data.chores.filter(choreOpen);
  const dueChores = byUrgency(openChores.filter((x) => ['overdue', 'today'].includes(dueStatus(x, today).status) && (!x.assignee || x.assignee === me)));
  const lateChores = dueChores.filter((x) => dueStatus(x, today).status === 'overdue').length;
  const soonChores = openChores.filter((x) => dueStatus(x, today).status === 'soon').length;
  const habits = data.habits.filter((x) => isActive(x) && (isWeekly(x) || isDueOn(x, today)));
  const daily = habits.filter((x) => !isWeekly(x));
  const doneDaily = daily.filter((x) => (data.log[today]?.[x.id] ?? 0) >= x.target).length;
  const dateText = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const core = question?.day?.core;

  return (
    <div className="td animate-fade-in">
      <header className="td-head">
        <div>
          <h1>{greeting()}</h1>
          <p>{dateText}</p>
        </div>
        {h.mode !== 'loading' && h.mode !== 'error' && (
          <div className="hb-level" title={`${level.xp} XP total`}>
            <span className="hb-level-badge">Lv {level.level}</span>
            <div className="hb-level-text">
              <strong>{level.title}</strong>
              <div className="hb-level-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={level.size} aria-valuenow={level.into}>
                <span style={{ width: `${(level.into / level.size) * 100}%` }} />
              </div>
              <small>{level.into} / {level.size} XP to level {level.level + 1}</small>
            </div>
          </div>
        )}
      </header>

      {h.mode === 'device' && (
        <div className="hb-banner">
          <span>Habits and answers are kept on this device only.</span>
          <button type="button" className="hb-small-btn" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in to keep them</button>
        </div>
      )}
      {ch.error && <div className="hb-banner is-error" role="alert"><span>{ch.error}</span><button type="button" className="hb-small-btn" onClick={ch.clearError}>OK</button></div>}
      {h.error && <div className="hb-banner is-error" role="alert"><span>{h.error}</span><button type="button" className="hb-small-btn" onClick={h.clearError}>OK</button></div>}
      {h.mode === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your day.</span><button type="button" className="hb-small-btn" onClick={h.reload}>Try again</button></div>}

      <div className="td-grid">
        {/* Today's question */}
        <section className={`td-card td-question${core ? ` is-${core.track}` : ''}`}>
          <div className="td-card-head">
            <h2><span aria-hidden>🧠</span> Today’s question</h2>
            {question && <span className="td-chip">🔥 {question.streak} day{question.streak === 1 ? '' : 's'}</span>}
          </div>
          {!question ? <p className="hb-hint">Loading…</p> : !core ? (
            <>
              <p className="hb-hint">No question today yet.</p>
              <Link className="btn btn-secondary" href="/daily#archive">Try one from the archive</Link>
            </>
          ) : (
            <>
              <p className="td-eyebrow">
                {question.day?.boss ? '👹 Boss problem · ' : ''}{TRACK_LABEL[core.track]} · {core.topic} · difficulty {core.difficulty}
              </p>
              <h3 className="td-question-title">{core.title}</h3>
              {question.status ? (
                <>
                  <p className="td-status">{STATUS[question.status]}{question.doneToday ? ' · streak kept' : ''}</p>
                  <Link className="btn btn-secondary" href="/daily">See the solution{question.day && question.day.bonus.length ? ` and ${question.day.bonus.length} bonus` : ''}</Link>
                </>
              ) : (
                <>
                  <p className="hb-hint">{question.streak ? `Answer it to make it ${question.streak + 1} days in a row.` : 'Answer it to start a streak.'}</p>
                  <Link className="btn btn-primary" href="/daily">Answer it</Link>
                </>
              )}
            </>
          )}
        </section>

        {/* Habits */}
        <section className="td-card td-habits">
          <div className="td-card-head">
            <h2><span aria-hidden>✅</span> Habits</h2>
            {daily.length > 0 && <span className={`td-chip${doneDaily === daily.length ? ' is-done' : ''}`}>{doneDaily} of {daily.length} done</span>}
          </div>
          {h.mode === 'loading' ? <p className="hb-hint">Loading…</p> : habits.length === 0 ? (
            <>
              <p className="hb-hint">{data.habits.some(isActive) ? 'Nothing due today. Enjoy it.' : 'No habits yet. Start with one small one.'}</p>
              <Link className="btn btn-secondary" href="/habits">{data.habits.some(isActive) ? 'Open habits' : 'Pick a habit'}</Link>
            </>
          ) : (
            <>
              <div className="hb-list">
                {habits.map((habit) => (
                  <HabitCard key={habit.id} habit={habit} value={data.log[today]?.[habit.id]} meta={habitMeta(habit, data.log, today, today, frozen)}
                    onSet={(value) => h.dispatch({ type: 'log', habitId: habit.id, date: today, value })} />
                ))}
              </div>
              <Link className="td-more" href="/habits">Garden, stats and editing →</Link>
            </>
          )}
        </section>

        {/* Chores */}
        <section className="td-card td-chores">
          <div className="td-card-head">
            <h2><span aria-hidden>🧹</span> Chores</h2>
            {(ch.mode === 'account' || ch.mode === 'device') && openChores.length > 0 && (
              <span className={`td-chip${dueChores.length ? '' : ' is-done'}${lateChores ? ' is-late' : ''}`}>
                {lateChores ? `${lateChores} overdue` : dueChores.length ? `${dueChores.length} due today` : 'All caught up'}
              </span>
            )}
          </div>
          {ch.mode === 'loading' ? <p className="hb-hint">Loading…</p> : openChores.length === 0 ? (
            <>
              <p className="hb-hint">Keep track of vacuuming, the bathroom, the vet, and share the list with your household.</p>
              <Link className="btn btn-secondary" href="/chores">Set up chores</Link>
            </>
          ) : dueChores.length === 0 ? (
            <>
              <p className="hb-hint">Nothing due today.{soonChores ? ` ${soonChores} coming up this week.` : ''}</p>
              <Link className="td-more" href="/chores">All chores →</Link>
            </>
          ) : (
            <>
              <div className="hb-list">
                {dueChores.slice(0, 6).map((chore) => (
                  <ChoreCard key={chore.id} chore={chore} data={ch.data} today={today} members={ch.household?.members ?? []} me={me}
                    onDone={() => ch.dispatch({ type: 'done', id: chore.id, date: today })}
                    onUndo={(entryId) => ch.dispatch({ type: 'undo', entryId })} />
                ))}
              </div>
              <Link className="td-more" href="/chores">{dueChores.length > 6 ? `${dueChores.length - 6} more, and the garden →` : 'All chores and the garden →'}</Link>
            </>
          )}
        </section>

        {/* Workout */}
        <section className="td-card td-workout">
          <div className="td-card-head">
            <h2><span aria-hidden>🏋️</span> Workout</h2>
            {workout && <span className="td-chip">{workout.thisWeek} this week</span>}
          </div>
          {!signedIn ? (
            <>
              <p className="hb-hint">Sign in to track workouts here. Without an account the tracker runs as a demo.</p>
              <Link className="btn btn-secondary" href="/workout">Try the tracker</Link>
            </>
          ) : !workout ? <p className="hb-hint">Loading…</p> : (
            <>
              <p className="td-status">
                {workout.last ? <>Last: <strong>{workout.last.name}</strong>, {/^(Today|Yesterday|\d+ days ago)$/.test(workout.last.when) ? workout.last.when.toLowerCase() : workout.last.when}</> : 'No workouts logged yet.'}
              </p>
              {workout.weekStreak > 0 && <p className="hb-hint">🔥 {workout.weekStreak}-week streak</p>}
              <Link className="btn btn-primary" href="/workout">{workout.thisWeek ? 'Start another workout' : 'Start a workout'}</Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
