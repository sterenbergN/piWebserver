'use client';

import { useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dayLabel, fmt, foodApi } from '@/lib/food/client';
import type { MaintenanceEstimate, MaintenanceShortfall } from '@/lib/food/maintenance';
import type { Nutrients } from '@/lib/food/types';

type WeekDay = { date: string; totals: Nutrients; logged: boolean; target: { kcal: number; protein: number; carbs: number; fat: number } };
type WeekData = {
  days: WeekDay[];
  averages: { loggedDays: number; kcal: number; protein: number; carbs: number; fat: number; targetKcal: number; targetProtein: number };
  insight: { estimate: MaintenanceEstimate | null; shortfall: MaintenanceShortfall | null; calculator: number | null; planEstimate: number | null };
};

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };
const tick = { fill: 'var(--muted)', fontSize: 10 };

/** The last 7/14/28 days: calories against target, averages, and real maintenance once there's enough data. */
export default function FoodWeekView({ end, onPickDay }: { end: string; onPickDay: (date: string) => void }) {
  const [span, setSpan] = useState<7 | 14 | 28>(7);
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    foodApi<WeekData>(`/api/food/week?end=${end}&days=${span}`)
      .then((res) => live && setData(res))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t load the week.'));
    return () => { live = false; };
  }, [end, span]);

  if (error) return <p className="workout-error">{error}</p>;
  if (!data) return <p className="workout-hint">Loading…</p>;
  const chart = data.days.map((d) => {
    const [, m, day] = d.date.split('-').map(Number);
    return { date: d.date, label: span === 7 ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : `${m}/${day}`, kcal: d.logged ? d.totals.kcal : null, target: d.target.kcal, protein: d.totals.protein };
  });
  const a = data.averages;
  const { estimate, shortfall, calculator, planEstimate } = data.insight;

  return (
    <>
      <div className="workout-segmented" role="group" aria-label="Days" style={{ marginBottom: '0.75rem' }}>
        {([7, 14, 28] as const).map((n) => <button key={n} type="button" aria-pressed={span === n} onClick={() => setSpan(n)}>{n} days</button>)}
      </div>
      <section className="workout-tile">
        <h3 className="workout-section-title" style={{ marginTop: 0 }}>Calories vs target</h3>
        <div className="food-week-chart" role="img" aria-label="Calories per day against the target">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -6 }} barCategoryGap="22%"
              onClick={(state) => { const i = Number(state?.activeTooltipIndex); if (Number.isInteger(i) && chart[i]) onPickDay(chart[i].date); }}>
              <CartesianGrid vertical={false} stroke="var(--surface-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={tick} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tickLine={false} axisLine={false} tick={tick} width={40} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }}
                contentStyle={tooltipStyle}
                labelFormatter={(_, items) => dayLabel(String((items?.[0]?.payload as { date?: string })?.date ?? ''))}
                formatter={(value, name) => [value === null || value === undefined ? 'nothing logged' : `${fmt(Number(value))} kcal`, name === 'target' ? 'Target' : 'Eaten']}
              />
              <Bar dataKey="kcal" fill="var(--accent-light)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
              <Line dataKey="target" type="stepAfter" stroke="var(--muted)" strokeDasharray="4 3" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="workout-hint" style={{ margin: '0.4rem 0 0' }}>Dashed line: target. Tap a day to open it.</p>
      </section>
      <section className="workout-tile">
        <h3 className="workout-section-title" style={{ marginTop: 0 }}>Daily average <small style={{ textTransform: 'none', letterSpacing: 0 }}>{a.loggedDays} of {span} days logged</small></h3>
        <div className="food-stats">
          <div className="food-stat"><span>Calories</span><strong>{fmt(a.kcal)}</strong> <small>/ {fmt(a.targetKcal)}</small></div>
          <div className="food-stat"><span>Protein</span><strong>{a.protein} g</strong> <small>/ {a.targetProtein} g</small></div>
          <div className="food-stat"><span>Carbs</span><strong>{a.carbs} g</strong></div>
          <div className="food-stat"><span>Fat</span><strong>{a.fat} g</strong></div>
        </div>
      </section>
      <section className="workout-tile food-insight">
        <h3 className="workout-section-title" style={{ marginTop: 0 }}>Your real maintenance</h3>
        {estimate ? (
          <>
            <div className="food-stats">
              <div className="food-stat"><span>From your logs and weigh-ins</span><strong>{fmt(estimate.kcal)}</strong> <small>kcal/day</small></div>
              <div className="food-stat"><span>Calculator says</span><strong>{calculator ? fmt(calculator) : '—'}</strong> <small>{calculator ? 'kcal/day' : 'no profile'}</small></div>
            </div>
            <p>
              Eating {fmt(estimate.avgIntake)} a day on average while your weight {estimate.weeklyChange < 0 ? 'fell' : estimate.weeklyChange > 0 ? 'rose' : 'held'}
              {estimate.weeklyChange ? ` ${Math.abs(estimate.weeklyChange)} lb a week` : ''} ({estimate.loggedDays} logged days, {estimate.weighIns} weigh-ins).
              {estimate.confidence === 'low' ? ' Rough so far: it firms up with more days.' : ''}
            </p>
            {planEstimate && <p className="workout-hint">The weight plan’s own estimate (from its calories, not your logs): {fmt(planEstimate)}.</p>}
          </>
        ) : (
          <p>
            Needs two weeks of logging and weigh-ins: {shortfall?.loggedDays ?? 0} of {shortfall?.needDays ?? 14} full days logged and {shortfall?.weighIns ?? 0} of {shortfall?.needWeighIns ?? 4} weigh-ins in the last four weeks.
            {calculator ? ` Until then, the calculator says ${fmt(calculator)} kcal.` : ''}
          </p>
        )}
      </section>
    </>
  );
}
