'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, dayOfWeek, eachDay, weekStart, type DateKey } from '@/lib/habits/dates';
import { isActive, isDone, type Habit, type HabitsData } from '@/lib/habits/habits';
import { completion, dayScore, dayStatus, habitStarts, habitStreak, isWeekly, perfectStreak, weekdayRates, type DayStatus } from '@/lib/habits/stats';
import { habitColor } from './HabitCard';

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };
const pct = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const fmtDay = (d: DateKey, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);

const STATUS_TEXT: Record<DayStatus, string> = { done: 'Done', missed: 'Missed', frozen: 'Frozen (streak kept)', slipped: 'Slipped', pending: 'Not yet', off: 'Not scheduled' };

/** Heatmap bucket for a day's share done: 0 = nothing, 4 = everything. */
function bucket(score: number | null) {
  if (score === null) return 'none';
  if (score === 0) return '0';
  if (score >= 1) return '4';
  return score >= 0.66 ? '3' : score >= 0.33 ? '2' : '1';
}

type Props = { data: HabitsData; today: DateKey; frozen: Set<DateKey>; freezes: number };

export default function HabitStats({ data, today, frozen, freezes }: Props) {
  const [focusId, setFocusId] = useState('all');
  const focus = data.habits.find((h) => h.id === focusId) ?? null;
  const selected = focus ? [focus] : data.habits;
  const starts = useMemo(() => habitStarts(data.habits, data.log), [data]);

  /** A day as the heatmap and calendar show it: a share of habits, or one habit's status. */
  const cell = (date: DateKey) => {
    if (focus) {
      const status = dayStatus(focus, data.log, date, today, frozen, starts.get(focus.id));
      return { cls: `is-${status}`, text: `${fmtDay(date)}: ${STATUS_TEXT[status]}` };
    }
    const score = dayScore(data.habits, data.log, date, today, frozen, starts);
    return { cls: `hm-${bucket(score)}`, text: `${fmtDay(date)}: ${score === null ? 'nothing scheduled' : `${pct(score)} done`}` };
  };

  const stats = useMemo(() => {
    const focused = data.habits.find((h) => h.id === focusId) ?? null;
    const selected = focused ? [focused] : data.habits;
    const last30 = completion(selected, data.log, addDays(today, -29), today, today, frozen);
    const streak = focused ? habitStreak(focused, data.log, today, frozen) : { ...perfectStreak(data, today, frozen), unit: 'day' as const };
    let checkIns = 0;
    for (const day of Object.values(data.log)) for (const h of selected) if (isDone(h, day[h.id])) checkIns++;
    const trend = eachDay(addDays(today, -89), today).map((d) => ({
      label: fmtDay(d, { month: 'short', day: 'numeric' }),
      rate: completion(selected, data.log, addDays(d, -6), d, today, frozen).rate,
    })).map((p) => ({ ...p, pct: p.rate === null ? null : Math.round(p.rate * 100) }));
    const weekdays = weekdayRates(selected, data.log, addDays(today, -89), today, frozen).map((w) => ({ ...w, pct: w.rate === null ? 0 : Math.round(w.rate * 100) }));
    const rows = data.habits.map((h) => ({
      habit: h,
      streak: habitStreak(h, data.log, today, frozen),
      rate: completion([h], data.log, addDays(today, -29), today, today, frozen).rate,
      total: Object.values(data.log).filter((day) => isDone(h, day[h.id])).length,
    }));
    return { last30, streak, checkIns, trend, weekdays, rows };
  }, [data, today, frozen, focusId]);

  // Heatmap: the last 26 weeks, one column per week (Monday on top).
  const weeks = useMemo(() => {
    const first = addDays(weekStart(today), -25 * 7);
    return Array.from({ length: 26 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  }, [today]);

  // Month calendar.
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const monthDays = useMemo(() => {
    const first = `${month}-01`;
    const days: (DateKey | null)[] = Array((dayOfWeek(first) + 6) % 7).fill(null);
    for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
    return days;
  }, [month]);
  const shiftMonth = (by: number) => {
    const [y, m] = month.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
    if (next <= today.slice(0, 7)) setMonth(next);
  };

  if (!data.habits.length) return <p className="hb-hint">Your charts appear here once you’ve added a habit.</p>;
  const streakUnit = stats.streak.unit === 'week' ? 'week' : 'day';
  const onlyWeekly = selected.every(isWeekly);

  return (
    <div className="hb-stats">
      <div className="hb-chips is-scroll" role="tablist" aria-label="Show stats for">
        <button type="button" role="tab" className="hb-chip" aria-selected={!focus} onClick={() => setFocusId('all')}>All habits</button>
        {data.habits.map((h) => (
          <button key={h.id} type="button" role="tab" className="hb-chip" aria-selected={focusId === h.id} onClick={() => setFocusId(h.id)} style={habitColor(h)}>
            <span className="hb-dot" aria-hidden /> <span aria-hidden>{h.emoji}</span> {h.name}{!isActive(h) ? ' (archived)' : ''}
          </button>
        ))}
      </div>

      <div className="hb-tiles">
        <div className="hb-tile"><span>Last 30 days</span><strong>{pct(stats.last30.rate)}</strong><small>{stats.last30.done} of {stats.last30.due} done</small></div>
        <div className="hb-tile"><span>{focus ? 'Streak' : 'Perfect days'}</span><strong>{stats.streak.current}</strong><small>{streakUnit}{stats.streak.current === 1 ? '' : 's'} in a row</small></div>
        <div className="hb-tile"><span>Best streak</span><strong>{stats.streak.best}</strong><small>{streakUnit}{stats.streak.best === 1 ? '' : 's'}</small></div>
        <div className="hb-tile"><span>Check-ins</span><strong>{stats.checkIns}</strong><small>all time</small></div>
        {!focus && <div className="hb-tile"><span>Freezes</span><strong>❄️ {freezes}</strong><small>save a missed day</small></div>}
      </div>

      <section className="hb-panel">
        <h3>Last 26 weeks</h3>
        {/* One grid filled column by column: the weekday labels first, then each week's seven days. */}
        <div className="hb-heatmap" role="group" aria-label="Completion by day, last 26 weeks" style={focus ? habitColor(focus) : undefined}>
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((label, i) => <span key={`l${i}`} className="hb-heatmap-label" aria-hidden>{label}</span>)}
          {weeks.flat().map((d) => {
            if (d > today) return <span key={d} className="hb-hm-cell is-future" aria-hidden />;
            const c = cell(d);
            return <span key={d} className={`hb-hm-cell ${c.cls}`} title={c.text} aria-label={c.text} />;
          })}
        </div>
        <div className="hb-legend" aria-hidden>
          {focus ? (
            <>
              <span><i className="hb-hm-cell is-done" style={habitColor(focus)} /> Done</span>
              <span><i className="hb-hm-cell is-missed" /> Missed</span>
              {focus.kind === 'avoid' && <span><i className="hb-hm-cell is-slipped" /> Slipped</span>}
              <span><i className="hb-hm-cell is-frozen" /> Frozen</span>
            </>
          ) : (
            <>Less <i className="hb-hm-cell hm-0" /><i className="hb-hm-cell hm-1" /><i className="hb-hm-cell hm-2" /><i className="hb-hm-cell hm-3" /><i className="hb-hm-cell hm-4" /> More</>
          )}
        </div>
      </section>

      <section className="hb-panel">
        <h3>Completion rate, 7-day average</h3>
        <div className="hb-chart" role="img" aria-label="Seven-day average completion rate over the last 90 days">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--surface-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} width={38} />
              <Tooltip cursor={{ stroke: 'var(--surface-border)' }} contentStyle={tooltipStyle} formatter={(v) => [`${v}% done`, '']} separator="" />
              <Line type="monotone" dataKey="pct" stroke={focus ? `var(--habit-${focus.color})` : 'var(--accent)'} strokeWidth={2} dot={false}
                activeDot={{ r: 5, stroke: 'var(--background)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="hb-panel">
        <h3>By day of the week</h3>
        {onlyWeekly ? <p className="hb-hint">Weekly habits can be done any day, so they aren’t split by weekday.</p> : (
          <div className="hb-chart is-short" role="img" aria-label="Completion rate by day of the week, last 90 days">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.weekdays} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="var(--surface-border)" />
                <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} width={38} />
                <Tooltip cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }} contentStyle={tooltipStyle} separator=""
                  formatter={(v, _n, item) => { const p = item?.payload as { done: number; due: number }; return [`${v}% (${p.done} of ${p.due})`, '']; }} />
                <Bar dataKey="pct" fill={focus ? `var(--habit-${focus.color})` : 'var(--accent)'} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="hb-panel">
        <div className="hb-month-head">
          <button type="button" className="hb-icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
          <h3>{new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
          <button type="button" className="hb-icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)} disabled={month >= today.slice(0, 7)}>›</button>
        </div>
        <div className="hb-month" style={focus ? habitColor(focus) : undefined}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="hb-month-dow" aria-hidden>{d}</span>)}
          {monthDays.map((d, i) => {
            if (!d) return <span key={`pad${i}`} />;
            if (d > today) return <span key={d} className="hb-month-day is-future">{Number(d.slice(8))}</span>;
            const c = cell(d);
            return <span key={d} className={`hb-month-day hb-hm-cell ${c.cls}${d === today ? ' is-today' : ''}`} title={c.text} aria-label={c.text}>{Number(d.slice(8))}</span>;
          })}
        </div>
      </section>

      <section className="hb-panel">
        <h3>Every habit</h3>
        <div className="hb-table-wrap">
          <table className="hb-table">
            <thead><tr><th scope="col">Habit</th><th scope="col">Streak</th><th scope="col">Best</th><th scope="col">30 days</th><th scope="col">Check-ins</th></tr></thead>
            <tbody>
              {stats.rows.map(({ habit, streak, rate, total }) => (
                <tr key={habit.id} style={habitColor(habit)}>
                  <th scope="row"><span className="hb-dot" aria-hidden /> {habit.emoji} {habit.name}</th>
                  <td>{streak.current} {streak.unit === 'week' ? 'wk' : 'd'}</td>
                  <td>{streak.best} {streak.unit === 'week' ? 'wk' : 'd'}</td>
                  <td>{pct(rate)}</td>
                  <td>{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
