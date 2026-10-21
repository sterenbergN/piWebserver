'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import HabitCard from '@/components/habits/HabitCard';
import ChoreCard from '@/components/chores/ChoreCard';
import { useChores } from '@/components/chores/useChores';
import { useHabits } from '@/components/habits/useHabits';
import { deviceProgress, readDeviceAttempts } from '@/components/daily/useDaily';
import { isActive } from '@/lib/habits/habits';
import { freezeState, habitMeta, habitXp, isDueOn, isWeekly, plantState } from '@/lib/habits/stats';
import { Plant } from '@/components/habits/Garden';
import { habitColor } from '@/components/habits/HabitCard';
import type { DateKey } from '@/lib/habits/dates';
import type { Habit, HabitLog } from '@/lib/habits/habits';
import type { Chore, ChoresData } from '@/lib/chores/chores';
import { levelFromXp } from '@/lib/progress/levels';
import LevelInfo from '@/components/progress/LevelInfo';
import { isOpen as choreOpen } from '@/lib/chores/chores';
import { byUrgency, choreXp, chorePlant, dueStatus } from '@/lib/chores/stats';
import { formatRelativeDay, trainingStreak } from '@/lib/workout/session-insights';
import type { PublicDay, QuestionStatus } from '@/lib/daily/grade';
import { TRACK_LABEL } from '@/lib/daily/types';
import '../habits/habits.css';
import '../chores/chores.css';
import './today.css';

type QuestionState = { day: PublicDay | null; status: QuestionStatus | null; streak: number; doneToday: boolean; xp: number; weeks?: { week: string; xp: number }[] };
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
  /** The level panel, opened from the level badge (or /today#level). */
  const [showLevel, setShowLevel] = useState(false);
  useEffect(() => { if (window.location.hash === '#level') setShowLevel(true); }, []);

  // Today's question, and how the question streak stands.
  useEffect(() => {
    if (h.mode !== 'account' && h.mode !== 'device') return;
    let cancelled = false;
    (async () => {
      try {
        const body = await fetch(`/api/daily?today=${today}`, { cache: 'no-store' }).then((r) => r.json());
        const day: PublicDay | null = body.day ?? null;
        let status: QuestionStatus | null = day ? body.answered?.[day.core.id]?.status ?? null : null;
        let progress: Pick<QuestionState, 'streak' | 'doneToday' | 'xp' | 'weeks'> = { streak: 0, doneToday: false, xp: 0 };
        if (body.signedIn) {
          const p = await fetch(`/api/daily/progress?today=${today}`, { cache: 'no-store' }).then((r) => r.json());
          if (p.success) progress = { streak: p.stats.streak.current, doneToday: p.stats.streak.doneToday, xp: p.stats.total.xp, weeks: p.stats.weeks };
        } else {
          const p = deviceProgress(today);
          progress = { streak: p.stats.streak.current, doneToday: p.stats.streak.doneToday, xp: p.stats.total.xp, weeks: p.stats.weeks };
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
  const xpSources = { questions: question?.xp ?? 0, habits: habitXp(data, today), chores: choreXp(ch.data, me) };
  const level = levelFromXp(xpSources.questions + xpSources.habits + xpSources.chores);
  // Chores due in the next week, overdue first (yours or anyone's).
  const openChores = ch.data.chores.filter(choreOpen);
  const dueChores = byUrgency(openChores.filter((x) => ['overdue', 'today', 'soon'].includes(dueStatus(x, today).status) && (!x.assignee || x.assignee === me)));
  const lateChores = dueChores.filter((x) => dueStatus(x, today).status === 'overdue').length;
  const todayChores = dueChores.filter((x) => dueStatus(x, today).status === 'today').length;
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
          <button type="button" className="hb-level td-level" aria-expanded={showLevel} aria-controls="level"
            title={`${level.xp} XP total. Tap for what your level means.`} onClick={() => setShowLevel((v) => !v)}>
            <span className="hb-level-badge">Lv {level.level}</span>
            <div className="hb-level-text">
              <strong>{level.title}</strong>
              <div className="hb-level-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={level.size} aria-valuenow={level.into}>
                <span style={{ width: `${(level.into / level.size) * 100}%` }} />
              </div>
              <small>{level.into} / {level.size} XP to level {level.level + 1}</small>
            </div>
            <span className="td-level-more" aria-hidden>{showLevel ? '▲' : 'ⓘ'}</span>
          </button>
        )}
      </header>

      {showLevel && h.mode !== 'loading' && h.mode !== 'error' && (
        <LevelInfo sources={xpSources} weeks={question?.weeks} onClose={() => setShowLevel(false)} />
      )}

      {h.mode === 'device' && (
        <div className="hb-banner">
          <span>Habits and answers are kept on this device only.</span>
          <button type="button" className="hb-small-btn" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in to keep them</button>
        </div>
      )}
      {ch.error && <div className="hb-banner is-error" role="alert"><span>{ch.error}</span><button type="button" className="hb-small-btn" onClick={ch.clearError}>OK</button></div>}
      {h.error && <div className="hb-banner is-error" role="alert"><span>{h.error}</span><button type="button" className="hb-small-btn" onClick={h.clearError}>OK</button></div>}
      {h.mode === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your day.</span><button type="button" className="hb-small-btn" onClick={h.reload}>Try again</button></div>}

      {/* Two columns that stack on their own, so a long habit list leaves no gap beside it. */}
      <div className="td-grid">
        <div className="td-col">
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
        <div className="td-col is-wide">
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
                  {lateChores ? `${lateChores} overdue` : todayChores ? `${todayChores} due today` : dueChores.length ? `${dueChores.length} this week` : 'All caught up'}
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
                <p className="hb-hint">Nothing due in the next week.</p>
                <Link className="td-more" href="/chores">All chores →</Link>
              </>
            ) : (
              <>
                <div className="hb-list">
                  {dueChores.slice(0, 8).map((chore) => (
                    <ChoreCard key={chore.id} chore={chore} data={ch.data} today={today} members={ch.household?.members ?? []} me={me}
                      onDone={() => ch.dispatch({ type: 'done', id: chore.id, date: today })}
                      onUndo={(entryId) => ch.dispatch({ type: 'undo', entryId })} />
                  ))}
                </div>
                <Link className="td-more" href="/chores">{dueChores.length > 8 ? `${dueChores.length - 8} more this week →` : 'All chores →'}</Link>
              </>
            )}
          </section>
        </div>
      </div>

      {(h.mode === 'account' || h.mode === 'device') && (
        <TodayGarden habits={data.habits} log={data.log} chores={openChores.filter((x) => x.repeat)} choresData={ch.data} today={today} frozen={frozen} />
      )}
    </div>
  );
}

/** Every plant at once: habits and chores side by side, with how many need some care. */
function TodayGarden({ habits, log, chores, choresData, today, frozen }: { habits: Habit[]; log: HabitLog; chores: Chore[]; choresData: ChoresData; today: DateKey; frozen: Set<DateKey> }) {
  const plants = [
    ...habits.filter(isActive).map((habit) => ({ id: `h-${habit.id}`, href: '/habits#garden', kind: 'Habit', item: habit, ...plantState(habit, log, today, frozen) })),
    ...chores.map((chore) => ({ id: `c-${chore.id}`, href: '/chores#garden', kind: 'Chore', item: chore, ...chorePlant(chore, choresData, today) })),
  ];
  if (!plants.length) return null;
  const thriving = plants.filter((p) => p.mood === 'thriving').length;
  const thirsty = plants.filter((p) => p.mood === 'wilting').length;
  const watered = plants.filter((p) => p.wateredToday).length;
  const grown = plants.filter((p) => p.stage >= 5).length;

  return (
    <section className="td-card td-garden">
      <div className="td-card-head">
        <h2><span aria-hidden>🌱</span> Your garden</h2>
        <span className="td-chip">{plants.length} plant{plants.length === 1 ? '' : 's'}</span>
      </div>
      <p className="td-garden-stats">
        <span>🌞 {thriving} thriving</span>
        {thirsty > 0 && <span className="is-late">🥀 {thirsty} need{thirsty === 1 ? 's' : ''} water</span>}
        <span>💧 {watered} watered today</span>
        {grown > 0 && <span>🌸 {grown} in bloom</span>}
      </p>
      <ul className="td-plants">
        {plants.map((p) => (
          <li key={p.id} style={habitColor(p.item)}>
            <Link href={p.href} title={`${p.kind}: ${p.item.name} · ${p.stageName}`}>
              <Plant stage={p.stage} mood={p.mood} watered={p.wateredToday} label={`${p.item.name}: ${p.stageName}, ${p.mood}`} />
              <span className="td-plant-name"><span aria-hidden>{p.item.emoji}</span> {p.item.name}</span>
              <span className="td-plant-stage">{p.stageName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
