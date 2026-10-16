'use client';

import { useMemo, useState } from 'react';
import { consistencyGrid, change, weeklySeries, type Insight, type Period, type periodSummary, type Workout, type ExerciseSession } from '@/lib/workout/insights';
import { formatProjection, goalProgress, type Goal } from '@/lib/workout/goals';
import { compact, Delta, WeeklyBars } from './charts';

const WEEKS_FOR: Record<Period, number> = { '4w': 8, '12w': 12, '6m': 26, '1y': 52, all: 52 };
const CAL_WEEKS = 16;

type SummaryTabProps = {
  history: Workout[];
  period: Period;
  periodLabel: string;
  summary: ReturnType<typeof periodSummary>;
  insights: Insight[];
  prs: { name: string; key: string; session: ExerciseSession }[];
  goals: Goal[];
  onOpenLift: (key: string) => void;
};

const shortDate = (iso: string | Date) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The period at a glance: headline numbers, weekly trend, consistency, insights, PRs, goals. */
export default function SummaryTab({ history, period, periodLabel, summary, insights, prs, goals, onOpenLift }: SummaryTabProps) {
  const [series, setSeries] = useState<'sets' | 'volume' | 'workouts'>('sets');
  const [day, setDay] = useState<string | null>(null);
  const weeks = useMemo(() => weeklySeries(history, WEEKS_FOR[period]), [history, period]);
  const grid = useMemo(() => consistencyGrid(history, CAL_WEEKS), [history]);
  const { current, previous } = summary;
  const vs = previous ? `vs previous ${periodLabel.toLowerCase()}` : '';
  const openGoals = goals.filter((g) => !g.achievedAt).map((goal) => ({ goal, progress: goalProgress(goal, history) })).slice(0, 4);
  const maxSets = Math.max(1, ...grid.flat().map((c) => c.sets));
  const level = (sets: number) => (sets === 0 ? 0 : Math.min(4, Math.ceil((sets / maxSets) * 4)));
  const selected = grid.flat().find((c) => c.key === day);
  const activeDays = grid.flat().filter((c) => c.sets > 0).length;

  return (
    <div className="an-stack">
      <section className="an-tiles" aria-label={`Last ${periodLabel}`}>
        <Tile label="Workouts" value={String(current.workouts)} sub={`${current.perWeek} per week`} delta={change(current.workouts, previous?.workouts)} vs={vs} />
        <Tile label="Sets" value={compact(current.sets)} sub={current.workouts ? `${Math.round(current.sets / current.workouts)} per workout` : ''} delta={change(current.sets, previous?.sets)} vs={vs} />
        <Tile label="Volume" value={`${compact(current.volume)} lb`} sub="weight × reps" delta={change(current.volume, previous?.volume)} vs={vs} />
        <Tile label="Avg workout" value={current.avgMinutes ? `${current.avgMinutes} min` : '—'} sub="from start to save" delta={current.avgMinutes && previous?.avgMinutes ? change(current.avgMinutes, previous.avgMinutes) : null} vs={vs} neutral />
      </section>

      {insights.length > 0 && (
        <section className="workout-tile an-card">
          <h2>Insights</h2>
          <ul className="an-insights">
            {insights.map((insight) => (
              <li key={insight.text} className={`is-${insight.tone}`}>
                <span aria-hidden>{insight.tone === 'good' ? '▲' : insight.tone === 'warn' ? '!' : '•'}</span>
                {insight.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="workout-tile an-card">
        <div className="an-card-head">
          <h2>Per week</h2>
          <div className="workout-segmented an-mini-seg">
            {(['sets', 'volume', 'workouts'] as const).map((key) => (
              <button key={key} type="button" aria-pressed={series === key} onClick={() => setSeries(key)}>{key === 'sets' ? 'Sets' : key === 'volume' ? 'Volume' : 'Workouts'}</button>
            ))}
          </div>
        </div>
        <WeeklyBars data={weeks} valueKey={series} unit={series === 'volume' ? 'lbs' : series} />
        <p className="workout-hint an-chart-note">Last {weeks.length} weeks · {series === 'volume' ? 'weight × reps lifted' : series === 'sets' ? 'working sets logged' : 'workouts saved'}</p>
      </section>

      <section className="workout-tile an-card">
        <div className="an-card-head">
          <h2>Consistency</h2>
          <span className="workout-hint">{activeDays} training days in {CAL_WEEKS} weeks</span>
        </div>
        <div className="an-cal" role="grid" aria-label="Training days, last 16 weeks">
          <div className="an-cal-days" aria-hidden>{['M', '', 'W', '', 'F', '', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
          {grid.map((week) => (
            <div key={week[0].key} className="an-cal-week" role="row">
              {week.map((cell) => {
                const future = cell.date.getTime() > Date.now();
                return (
                  <button
                    key={cell.key}
                    type="button"
                    role="gridcell"
                    className={`an-cal-cell lv-${level(cell.sets)}${day === cell.key ? ' is-selected' : ''}`}
                    disabled={future}
                    aria-label={`${cell.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${cell.sets ? `${cell.sets} sets` : 'rest'}`}
                    title={`${shortDate(cell.date)}: ${cell.sets ? `${cell.sets} sets` : 'rest'}`}
                    onClick={() => setDay(day === cell.key ? null : cell.key)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="an-legend" aria-hidden>
          <span>Rest</span>
          {[0, 1, 2, 3, 4].map((lv) => <i key={lv} className={`an-cal-cell lv-${lv}`} />)}
          <span>More sets</span>
        </div>
        {selected && (
          <p className="an-cal-detail">
            <strong>{selected.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
            {selected.sets ? ` · ${selected.workouts.map((w) => w.name).join(', ')} · ${selected.sets} sets` : ' · rest day'}
          </p>
        )}
      </section>

      <section className="workout-tile an-card">
        <div className="an-card-head">
          <h2>Personal records</h2>
          <span className="workout-hint">{prs.length} in {periodLabel.toLowerCase()}</span>
        </div>
        {prs.length === 0 ? (
          <p className="workout-hint">No new best estimated 1RM in this period yet.</p>
        ) : (
          <div className="workout-stack">
            {prs.slice(0, 6).map((pr) => (
              <button key={`${pr.key}-${pr.session.timestamp}`} type="button" className="workout-lift-row" onClick={() => onOpenLift(pr.key)}>
                <span className="workout-card-text">
                  <span className="workout-card-title">🏆 {pr.name}</span>
                  <span className="workout-card-meta">{pr.session.top.weight} × {pr.session.top.reps} · est. 1RM {Math.round(pr.session.e1rm)} lbs</span>
                </span>
                <span className="workout-hint" style={{ flexShrink: 0 }}>{shortDate(pr.session.timestamp)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {openGoals.length > 0 && (
        <section className="workout-tile an-card">
          <div className="an-card-head">
            <h2>Goals</h2>
            <a href="/workout" className="workout-text-btn">Edit on home</a>
          </div>
          <div className="workout-stack">
            {openGoals.map(({ goal, progress }) => (
              <div key={goal.id} className="an-goal">
                <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                  <strong>{goal.exercise} {goal.targetWeight} × {goal.targetReps}</strong>
                  <span className="workout-hint">{Math.round(progress.fraction * 100)}%</span>
                </div>
                <div className="an-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)} aria-label={`${goal.exercise} goal progress`}>
                  <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} className={progress.behind ? 'is-behind' : ''} />
                </div>
                <span className="workout-hint">{formatProjection(progress)}{progress.behind ? ' · behind target date' : ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, sub, delta, vs, neutral = false }: { label: string; value: string; sub?: string; delta: number | null; vs: string; neutral?: boolean }) {
  return (
    <div className="an-tile">
      <span className="an-tile-label">{label}</span>
      <strong className="an-tile-value">{value}</strong>
      {sub && <span className="an-tile-sub">{sub}</span>}
      {delta !== null && (
        <span className="an-tile-sub" title={vs}>{neutral ? <span className="an-delta">{delta > 0 ? '+' : ''}{Math.round(delta * 100)}%</span> : <Delta value={delta} />} <span className="an-vs">{vs}</span></span>
      )}
    </div>
  );
}
