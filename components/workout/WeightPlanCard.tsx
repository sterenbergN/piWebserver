'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, planProgress, type WeighIn, type WeightPlan } from '@/lib/workout/weight-plan';
import './weight-plan.css';

type Props = {
  plan: WeightPlan;
  entries: WeighIn[];
  today: string;
  /** Log a weigh-in for today (returns the updated log). */
  onLog?: (weight: number) => Promise<void>;
  onEdit: () => void;
  onEnd: () => void;
};

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };
const tick = { fill: 'var(--muted)', fontSize: 10 };
const fmtDate = (iso: string, withYear = false) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
};
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

/** Plan / weigh-ins / trend / new projection, all against one weight axis. */
function PlanChart({ plan, progress }: { plan: WeightPlan; progress: ReturnType<typeof planProgress> }) {
  const { planned, weighIns, reprojection, totalDays, today } = progress;
  // One row per day so every series shares the x axis (days from the start).
  const rows = useMemo(() => {
    const byDay = new Map<number, Record<string, number>>();
    const row = (day: number) => { if (!byDay.has(day)) byDay.set(day, { day }); return byDay.get(day)!; };
    planned.forEach((w, day) => { row(day).plan = w; });
    weighIns.forEach((e) => { row(e.day).weighIn = e.weight; row(e.day).trend = e.average; });
    reprojection.forEach((p) => { row(p.day).projection = p.weight; });
    return [...byDay.values()].sort((a, b) => a.day - b.day);
  }, [planned, weighIns, reprojection]);
  const values = rows.flatMap((r) => [r.plan, r.weighIn, r.projection].filter((v): v is number => typeof v === 'number'));
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const ticks = Array.from({ length: Math.min(6, Math.ceil(totalDays / 7) + 1) }, (_, i) => Math.round((i * totalDays) / Math.min(5, Math.ceil(totalDays / 7))));

  return (
    <div className="wp-chart" role="img" aria-label="Planned weight, your weigh-ins, and the projection from today">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--surface-border)" />
          <XAxis dataKey="day" type="number" domain={[0, totalDays]} ticks={ticks} tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} tickFormatter={(d) => fmtDate(addDays(plan.startDate, d))} />
          <YAxis tickLine={false} axisLine={false} tick={tick} domain={[min, max]} allowDecimals={false} width={40} />
          {today >= 0 && today <= totalDays && (
            <ReferenceLine x={today} stroke="var(--muted)" strokeDasharray="2 3" label={{ value: 'Today', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 10 }} />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--surface-border)' }}
            contentStyle={tooltipStyle}
            labelFormatter={(d) => fmtDate(addDays(plan.startDate, Number(d)), true)}
            formatter={(value, name) => [`${Number(value).toFixed(1)} lb`, ({ plan: 'Plan', weighIn: 'Weigh-in', trend: '7-day average', projection: 'New projection' } as Record<string, string>)[String(name)] || String(name)]}
          />
          <Line dataKey="plan" type="monotone" stroke="var(--muted)" strokeOpacity={0.75} strokeWidth={2} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="projection" type="monotone" stroke="var(--accent-light)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="trend" type="monotone" stroke="var(--accent)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          {/* Weigh-ins as dots only: no line, and nothing drawn on days without one. */}
          <Line dataKey="weighIn" stroke="none" isAnimationActive={false} dot={{ r: 3.5, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 1.5 }} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A weight plan in progress: how today compares with the plan, the planned
 * line with your weigh-ins and their trend over it, and the same calories
 * re-projected from where you are now.
 */
export default function WeightPlanCard({ plan, entries, today, onLog, onEdit, onEnd }: Props) {
  const progress = useMemo(() => planProgress(plan, entries, today), [plan, entries, today]);
  const [input, setInput] = useState('');
  const [logging, setLogging] = useState(false);
  const { status, aheadBy, current, expectedNow, plannedEnd, projectedEnd, neededCalories, pace, plannedPace, totalDays } = progress;
  const endDate = addDays(plan.startDate, totalDays);
  const week = Math.min(plan.weeks, Math.max(1, Math.ceil((progress.today + 1) / 7)));
  const losing = plannedEnd < plan.startWeightLbs;
  const goalLabel = plan.goalRate < 0 ? `Lose ${Math.abs(plan.goalRate)} lb/week` : plan.goalRate > 0 ? `Gain ${plan.goalRate} lb/week` : 'Maintain';

  const statusText = {
    'not-started': `Starts ${fmtDate(plan.startDate)}`,
    'no-data': 'Log a weigh-in to compare',
    ahead: `${Math.abs(aheadBy ?? 0).toFixed(1)} lb ahead`,
    'on-track': 'On track',
    behind: `${Math.abs(aheadBy ?? 0).toFixed(1)} lb behind`,
    finished: 'Plan finished',
  }[status];

  const log = async () => {
    const weight = parseFloat(input);
    if (!onLog || !Number.isFinite(weight)) return;
    setLogging(true);
    try { await onLog(weight); setInput(''); } finally { setLogging(false); }
  };

  return (
    <section className="workout-tile wp-card">
      <div className="wp-head">
        <div>
          <span className="wp-kicker">Your plan · week {week} of {plan.weeks}</span>
          <h3>{goalLabel} · {plan.targetCalories.toLocaleString()} kcal/day</h3>
          <span className="workout-hint">{fmtDate(plan.startDate)} → {fmtDate(endDate, true)} · {plan.startWeightLbs} → {plannedEnd} lb</span>
        </div>
        <span className={`wp-status is-${status}`}>{statusText}</span>
      </div>

      <PlanChart plan={plan} progress={progress} />
      <div className="wp-legend" aria-hidden>
        <span><i className="wp-key is-plan" />Plan</span>
        <span><i className="wp-key is-dot" />Weigh-ins</span>
        <span><i className="wp-key is-trend" />7-day average</span>
        <span><i className="wp-key is-projection" />From today</span>
      </div>

      <div className="wp-stats">
        <div>
          <span>Now</span>
          <strong>{current ? `${current.weight} lb` : '—'}</strong>
          <small>{expectedNow !== null && current ? `plan ${expectedNow} lb` : 'trend of recent weigh-ins'}</small>
        </div>
        <div>
          <span>Finish on this pace</span>
          <strong>{projectedEnd !== null ? `${projectedEnd} lb` : '—'}</strong>
          <small>plan {plannedEnd} lb{projectedEnd !== null ? ` (${signed(projectedEnd - plannedEnd)})` : ''}</small>
        </div>
        <div>
          <span>Real pace</span>
          <strong>{pace !== null ? `${signed(pace, 2)} lb/wk` : '—'}</strong>
          <small>plan {signed(plannedPace, 2)} lb/wk</small>
        </div>
        <div>
          <span>To finish on plan</span>
          <strong>{neededCalories !== null ? `${neededCalories.toLocaleString()} kcal` : '—'}</strong>
          <small>{neededCalories !== null ? `${signed(neededCalories - plan.targetCalories, 0)} vs plan a day` : 'needs a week left'}</small>
        </div>
      </div>
      {status === 'behind' && neededCalories !== null && (
        <p className="workout-hint wp-note">
          Your weight is {losing ? 'higher' : 'lower'} than planned. Eating about <strong>{neededCalories.toLocaleString()}</strong> kcal a day from now would still reach {plannedEnd} lb by {fmtDate(endDate)} — or keep the plan and expect to finish near {projectedEnd} lb.
        </p>
      )}
      {status === 'ahead' && neededCalories !== null && (
        <p className="workout-hint wp-note">
          Ahead of plan. You could eat about <strong>{neededCalories.toLocaleString()}</strong> kcal a day and still reach {plannedEnd} lb by {fmtDate(endDate)}.
        </p>
      )}

      {onLog && (
        <div className="wp-log">
          <input className="workout-input" type="number" inputMode="decimal" placeholder={current ? `Today's weight (last ${entries[entries.length - 1]?.weight ?? current.weight})` : "Today's weight (lb)"} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') log(); }} />
          <button type="button" className="workout-button" disabled={logging || !input} onClick={log}>{logging ? 'Saving…' : 'Log'}</button>
        </div>
      )}
      <div className="wp-actions">
        <button type="button" className="workout-text-btn" onClick={onEdit}>Adjust in the calculator</button>
        <button type="button" className="workout-text-btn danger" onClick={onEnd}>End plan</button>
      </div>
    </section>
  );
}
