'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import HabitCard from '@/components/habits/HabitCard';
import HabitEditor, { TEMPLATES } from '@/components/habits/HabitEditor';
import ManageHabits from '@/components/habits/ManageHabits';
import Garden from '@/components/habits/Garden';
import HabitStats from '@/components/habits/HabitStats';
import Confetti from '@/components/habits/Confetti';
import { useHabits } from '@/components/habits/useHabits';
import { addDays, type DateKey } from '@/lib/habits/dates';
import { isActive, type Habit, type HabitInput } from '@/lib/habits/habits';
import { dayScore, FREEZE_EVERY, MAX_FREEZES, freezeState, habitMeta, habitStarts, habitXp, isDueOn, isPerfectDay, isWeekly, perfectStreak, XP } from '@/lib/habits/stats';
import { levelFromXp } from '@/lib/progress/levels';
import { choresXpElsewhere, questionsXpElsewhere } from '@/components/progress/otherXp';
import LevelInfo from '@/components/progress/LevelInfo';
import './habits.css';

const TABS = [
  { id: 'today', icon: '☀️', label: 'Today' },
  { id: 'garden', icon: '🌱', label: 'Garden' },
  { id: 'stats', icon: '📈', label: 'Stats' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

export default function HabitsPage() {
  const h = useHabits();
  const { data, today } = h;
  const { confirm, popup } = useSitePopup();
  const [tab, setTab] = useState<TabId>('today');
  const [pickedDay, setPickedDay] = useState<DateKey | null>(null);
  const day = pickedDay && pickedDay <= today ? pickedDay : today;
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const [managing, setManaging] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [toast, setToast] = useState('');

  // The open tab lives in the URL (#stats) so it survives a refresh.
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

  // The profile level also counts XP from daily questions and chores.
  const [otherXp, setOtherXp] = useState<{ questions: number; chores: number } | null>(null);
  useEffect(() => {
    if (h.mode === 'account' || h.mode === 'device') Promise.all([questionsXpElsewhere(), choresXpElsewhere()]).then(([questions, chores]) => setOtherXp({ questions, chores }));
  }, [h.mode]);
  const elsewhereXp = otherXp ? otherXp.questions + otherXp.chores : null;
  /** The level panel, opened from the level badge (or /habits#level). */
  const [showLevel, setShowLevel] = useState(false);
  useEffect(() => { if (window.location.hash === '#level') setShowLevel(true); }, []);

  const derived = useMemo(() => {
    const freezes = freezeState(data, today);
    const xp = habitXp(data, today) + (elsewhereXp ?? 0);
    return {
      ...freezes,
      level: levelFromXp(xp),
      perfect: perfectStreak(data, today, freezes.frozen),
      perfectToday: isPerfectDay(data, today),
      starts: habitStarts(data.habits, data.log),
    };
  }, [data, today, elsewhereXp]);

  // Confetti for a perfect day and a level up, but not for what was already true on load.
  const seen = useRef<{ level: number; perfectToday: boolean } | null>(null);
  useEffect(() => {
    // Wait for question and chore XP, so it arriving isn't mistaken for a level up.
    if ((h.mode !== 'account' && h.mode !== 'device') || elsewhereXp === null) return;
    const now = { level: derived.level.level, perfectToday: derived.perfectToday };
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    if (now.level > before.level) {
      setConfetti(Date.now());
      setToast(`Level ${now.level}! You’re a ${derived.level.title.toLowerCase()} now.`);
    } else if (now.perfectToday && !before.perfectToday) {
      setConfetti(Date.now());
      setToast(`Perfect day! +${XP.perfectDay} XP`);
      vibrate([30, 60, 30]);
    }
  }, [derived, h.mode, elsewhereXp]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const active = data.habits.filter(isActive);
  const dueToday = active.filter((x) => isWeekly(x) || isDueOn(x, day));
  const restDay = active.filter((x) => !isWeekly(x) && !isDueOn(x, day));
  // The count matches what makes a perfect day: daily and weekday habits (weekly ones are any-day).
  const dailyDue = dueToday.filter((x) => !isWeekly(x));
  const doneCount = dailyDue.filter((x) => (data.log[day]?.[x.id] ?? 0) >= x.target).length;
  const editable = day >= addDays(today, -6);

  const metaFor = (habit: Habit) => habitMeta(habit, data.log, day, today, derived.frozen);

  const save = (input: HabitInput) => h.dispatch({ type: 'save', habit: editing && editing !== 'new' ? { ...input, id: editing.id } : input });
  const signIn = () => window.dispatchEvent(new Event('site:sign-in'));

  return (
    <div className="hb animate-fade-in">
      <Confetti fire={confetti} />
      {popup}

      <header className="hb-head">
        <div>
          <h1>Habits</h1>
          <p>Small things, every day. Keep the streak, grow the garden.</p>
        </div>
        {h.mode !== 'loading' && h.mode !== 'error' && (
          <button type="button" className="hb-level hb-level-btn" aria-expanded={showLevel} aria-controls="level"
            title={`${derived.level.xp} XP total. Tap for what your level means.`} onClick={() => setShowLevel((v) => !v)}>
            <span className="hb-level-badge">Lv {derived.level.level}</span>
            <div className="hb-level-text">
              <strong>{derived.level.title}</strong>
              <div className="hb-level-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={derived.level.size} aria-valuenow={derived.level.into}>
                <span style={{ width: `${(derived.level.into / derived.level.size) * 100}%` }} />
              </div>
              <small>{derived.level.into} / {derived.level.size} XP · 🔥 {derived.perfect.current} · ❄️ {derived.available}</small>
            </div>
            <span className="hb-level-more" aria-hidden>{showLevel ? '▲' : 'ⓘ'}</span>
          </button>
        )}
      </header>

      {showLevel && h.mode !== 'loading' && h.mode !== 'error' && (
        <LevelInfo sources={{ questions: otherXp?.questions ?? 0, habits: habitXp(data, today), chores: otherXp?.chores ?? 0 }} onClose={() => setShowLevel(false)} />
      )}

      {h.mode === 'device' && (
        <div className="hb-banner">
          <span>Saved on this device only.</span>
          <button type="button" className="hb-small-btn" onClick={signIn}>Sign in to keep them</button>
        </div>
      )}
      {h.deviceData && (
        <div className="hb-banner">
          <span>{h.deviceData.habits.length} habit{h.deviceData.habits.length === 1 ? ' is' : 's are'} saved on this device from before you signed in.</span>
          <button type="button" className="hb-small-btn is-primary" onClick={h.importDevice}>Add to my account</button>
          <button type="button" className="hb-small-btn" onClick={h.dismissDevice}>Discard</button>
        </div>
      )}
      {h.error && (
        <div className="hb-banner is-error" role="alert">
          <span>{h.error}</span>
          <button type="button" className="hb-small-btn" onClick={h.clearError}>OK</button>
        </div>
      )}

      {h.mode === 'loading' && <p className="hb-hint">Loading your habits…</p>}
      {h.mode === 'error' && (
        <div className="hb-banner is-error">
          <span>Couldn’t load your habits.</span>
          <button type="button" className="hb-small-btn" onClick={h.reload}>Try again</button>
        </div>
      )}

      {(h.mode === 'account' || h.mode === 'device') && (
        <>
          <div className="hb-tabs" role="tablist" aria-label="Habits">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => chooseTab(t.id)}>
                <span aria-hidden>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          {tab === 'today' && (active.length === 0 ? (
            <section className="hb-empty">
              <h2>Start with one small habit</h2>
              <p className="hb-hint">Tap one to add it, or make your own. You can change everything later.</p>
              <div className="hb-template-grid">
                {TEMPLATES.map((t) => (
                  <button key={t.name} type="button" className="hb-template" onClick={() => h.dispatch({ type: 'save', habit: t })}>
                    <span aria-hidden>{t.emoji}</span>{t.name}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Make your own</button>
            </section>
          ) : (
            <section>
              <div className="hb-days-strip" role="radiogroup" aria-label="Day">
                {Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => {
                  const score = dayScore(active, data.log, d, today, derived.frozen, derived.starts);
                  return (
                    <button key={d} type="button" role="radio" aria-checked={d === day} className="hb-day-pill" onClick={() => setPickedDay(d)}
                      aria-label={`${fmtDay(d, { weekday: 'long', month: 'short', day: 'numeric' })}${score === null ? '' : `, ${Math.round(score * 100)}% done`}`}>
                      <span>{fmtDay(d, { weekday: 'narrow' })}</span>
                      <strong>{Number(d.slice(8))}</strong>
                      <i className="hb-day-fill" style={{ height: `${(score ?? 0) * 100}%` }} aria-hidden />
                    </button>
                  );
                })}
              </div>

              <div className="hb-day-head">
                <h2>{day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
                <span className={`hb-day-count${dailyDue.length && doneCount === dailyDue.length ? ' is-perfect' : ''}`}>
                  {dailyDue.length ? `${doneCount} of ${dailyDue.length} done` : 'Nothing due'}
                </span>
              </div>
              {day !== today && <p className="hb-hint">Filling in a past day. Streaks, freezes and XP update to match.</p>}

              <div className="hb-list">
                {dueToday.map((habit) => (
                  <HabitCard key={habit.id} habit={habit} value={data.log[day]?.[habit.id]} meta={metaFor(habit)} disabled={!editable}
                    onSet={(value) => h.dispatch({ type: 'log', habitId: habit.id, date: day, value })} />
                ))}
              </div>
              {restDay.length > 0 && (
                <details className="hb-rest">
                  <summary>Not scheduled {day === today ? 'today' : 'this day'} ({restDay.length})</summary>
                  <div className="hb-list">
                    {restDay.map((habit) => (
                      <HabitCard key={habit.id} habit={habit} value={data.log[day]?.[habit.id]} meta={metaFor(habit)} disabled={!editable}
                        onSet={(value) => h.dispatch({ type: 'log', habitId: habit.id, date: day, value })} />
                    ))}
                  </div>
                </details>
              )}

              <div className="hb-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditing('new')}>+ New habit</button>
                <button type="button" className="btn btn-secondary" onClick={() => setManaging(true)}>Edit habits</button>
              </div>
              <p className="hb-hint hb-howto">
                Hold a circle to check a habit off. Every {FREEZE_EVERY} perfect days in a row earns a ❄️ freeze (up to {MAX_FREEZES}), which saves your streak on a day you miss.
              </p>
            </section>
          ))}

          {tab === 'garden' && <Garden habits={data.habits} log={data.log} today={today} frozen={derived.frozen} />}
          {tab === 'stats' && <HabitStats data={data} today={today} frozen={derived.frozen} freezes={derived.available} />}
        </>
      )}

      {toast && <div className="hb-toast" role="status">{toast}</div>}

      {editing && (
        <HabitEditor habit={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)}
          onManage={() => { setEditing(null); setManaging(true); }} />
      )}
      {managing && (
        <ManageHabits habits={data.habits} dispatch={h.dispatch} confirm={confirm} onClose={() => setManaging(false)}
          onEdit={(habit) => { setManaging(false); setEditing(habit); }} />
      )}
    </div>
  );
}
