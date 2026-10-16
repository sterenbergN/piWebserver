'use client';

import { useMemo, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { rirLabel } from '@/components/workout/SetEditSheet';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { formatProjection, goalProgress, goalsFor, type Goal } from '@/lib/workout/goals';
import type { ProgressReview } from '@/lib/workout/progression';
import type { ExerciseStat, Workout } from '@/lib/workout/insights';
import { Delta, Sparkline, StrengthLine } from './charts';

// Bodyweight multiples (estimated 1RM ÷ bodyweight) for common strength levels.
const STANDARDS: { name: string; match: string[]; levels: [string, number][] }[] = [
  { name: 'Bench Press', match: ['bench press'], levels: [['Beginner', 0.5], ['Novice', 0.75], ['Intermediate', 1], ['Advanced', 1.5], ['Elite', 2]] },
  { name: 'Squat', match: ['back squat', 'squat'], levels: [['Beginner', 0.75], ['Novice', 1], ['Intermediate', 1.5], ['Advanced', 2], ['Elite', 2.5]] },
  { name: 'Deadlift', match: ['deadlift'], levels: [['Beginner', 1], ['Novice', 1.25], ['Intermediate', 1.75], ['Advanced', 2.5], ['Elite', 3]] },
  { name: 'Overhead Press', match: ['overhead press', 'military press', 'ohp'], levels: [['Beginner', 0.35], ['Novice', 0.5], ['Intermediate', 0.75], ['Advanced', 1], ['Elite', 1.35]] },
];

type Sort = 'recent' | 'gain' | 'strongest' | 'name';

type LiftsTabProps = {
  stats: ExerciseStat[];
  periodLabel: string;
  goals: Goal[];
  history: Workout[];
  bodyweight?: number;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  reviewFor: (name: string) => ProgressReview | undefined;
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Every exercise you do (linked lifts combined across gyms) with its strength trend. */
export default function LiftsTab({ stats, periodLabel, goals, history, bodyweight, openKey, onOpen, reviewFor }: LiftsTabProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    const filtered = stats.filter((s) => !q || s.name.toLowerCase().includes(q) || s.muscle.toLowerCase().includes(q));
    const by: Record<Sort, (a: ExerciseStat, b: ExerciseStat) => number> = {
      recent: (a, b) => new Date(b.lastDone).getTime() - new Date(a.lastDone).getTime(),
      gain: (a, b) => (b.periodChange ?? -Infinity) - (a.periodChange ?? -Infinity),
      strongest: (a, b) => b.current - a.current,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...filtered].sort(by[sort]);
  }, [stats, q, sort]);
  const open = stats.find((s) => s.key === openKey);

  const standards = STANDARDS.map((std) => {
    const stat = std.match.map((m) => stats.find((s) => s.key === m)).find(Boolean)
      || stats.filter((s) => std.match.some((m) => s.key.includes(m)) && !/incline|decline|close|dumbbell|front|smith|romanian/.test(s.key)).sort((a, b) => b.current - a.current)[0];
    if (!stat || !bodyweight) return { std, stat, multiple: 0, level: '', next: null as [string, number] | null };
    const multiple = stat.current / bodyweight;
    const reached = std.levels.filter(([, m]) => multiple >= m);
    return { std, stat, multiple, level: reached.length ? reached[reached.length - 1][0] : 'Untrained', next: std.levels.find(([, m]) => multiple < m) || null };
  }).filter((s) => s.stat);

  return (
    <div className="an-stack">
      {standards.length > 0 && bodyweight ? (
        <section className="workout-tile an-card">
          <div className="an-card-head">
            <h2>Strength level</h2>
            <span className="workout-hint">at {bodyweight} lb bodyweight</span>
          </div>
          <div className="workout-stack">
            {standards.map(({ std, stat, multiple, level, next }) => (
              <button key={std.name} type="button" className="an-standard" onClick={() => onOpen(stat!.key)}>
                <span className="workout-flex-between" style={{ gap: '0.5rem' }}>
                  <strong>{stat!.name}</strong>
                  <span>{multiple.toFixed(2)}× · <strong>{level}</strong></span>
                </span>
                <span className="an-meter" aria-hidden>
                  <span style={{ width: `${Math.min(100, (multiple / std.levels[std.levels.length - 1][1]) * 100)}%` }} />
                </span>
                <span className="workout-hint">{next ? `${next[0]} at ${Math.round(next[1] * bodyweight)} lb est. 1RM (now ${Math.round(stat!.current)})` : 'Top level reached'}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="workout-tile an-card">
        <div className="an-card-head">
          <h2>Exercises <span className="workout-hint">({stats.length})</span></h2>
          <select className="workout-input an-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort exercises">
            <option value="recent">Recent</option>
            <option value="gain">Biggest gain</option>
            <option value="strongest">Strongest</option>
            <option value="name">A–Z</option>
          </select>
        </div>
        <input className="workout-input" type="search" placeholder="Search exercises or muscles" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="workout-stack">
          {list.map((stat) => (
            <button key={stat.key} type="button" className="workout-lift-row an-lift-row" onClick={() => onOpen(stat.key)}>
              <span className="workout-card-text">
                <span className="workout-card-title">{stat.name}</span>
                <span className="workout-card-meta">
                  {stat.current > 0 ? `${Math.round(stat.current)} lb est. 1RM · ` : ''}{stat.sessions.length} session{stat.sessions.length === 1 ? '' : 's'} · {shortDate(stat.lastDone)}
                </span>
              </span>
              <span className="an-lift-trend">
                <Sparkline values={stat.sessions.slice(-8).map((s) => s.e1rm)} />
                <Delta value={stat.periodChange} />
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="workout-hint">No exercises match.</p>}
        </div>
        <p className="workout-hint an-chart-note">Change is over the last {periodLabel.toLowerCase()}. Lifts that count as the same exercise are combined across gyms.</p>
      </section>

      {open && <LiftDetail stat={open} goals={goals} history={history} review={reviewFor(open.name)} onClose={() => onOpen(null)} />}
    </div>
  );
}

function LiftDetail({ stat, goals, history, review, onClose }: { stat: ExerciseStat; goals: Goal[]; history: Workout[]; review?: ProgressReview; onClose: () => void }) {
  const goal = goalsFor(goals, stat.name)[0];
  const progress = goal ? goalProgress(goal, history) : null;
  const chartData = stat.sessions.slice(-20).map((s) => ({ label: shortDate(s.timestamp), e1rm: Math.round(s.e1rm), detail: `${s.top.weight}×${s.top.reps}${s.gymName ? ` · ${s.gymName}` : ''}` }));
  const recent = [...stat.sessions].reverse().slice(0, 8);
  return (
    <Sheet title={stat.name} subtitle={`${stat.muscle}${stat.gyms.length ? ` · ${stat.gyms.join(', ')}` : ''}`} onClose={onClose}>
      <div className="an-tiles is-three">
        <div className="an-tile"><span className="an-tile-label">Est. 1RM now</span><strong className="an-tile-value">{Math.round(stat.current)}</strong><span className="an-tile-sub">best of last 3</span></div>
        <div className="an-tile"><span className="an-tile-label">All-time best</span><strong className="an-tile-value">{Math.round(stat.best)}</strong><span className="an-tile-sub">{stat.sessions.length} sessions</span></div>
        <div className="an-tile"><span className="an-tile-label">This period</span><strong className="an-tile-value">{stat.periodChange === null ? '—' : <Delta value={stat.periodChange} />}</strong><span className="an-tile-sub">{stat.sessionsInPeriod} sessions</span></div>
      </div>

      {chartData.length >= 2 ? (
        <>
          <div className="workout-section-title">Estimated 1RM</div>
          <StrengthLine data={chartData} goal={goal ? calcAverage1RM(goal.targetWeight, goal.targetReps) : undefined} />
        </>
      ) : <p className="workout-hint">One session so far — the trend appears after the next one.</p>}
      {goal && progress && (
        <p className="workout-hint">🎯 Goal {goal.targetWeight} × {goal.targetReps} · {Math.round(progress.fraction * 100)}% · {formatProjection(progress)}</p>
      )}

      {stat.repRecords.length > 0 && (<>
        <div className="workout-section-title">Rep records <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>heaviest weight for at least that many reps</span></div>
        <div className="an-records">
          {stat.repRecords.map((r) => (
            <div key={r.reps}><span>{r.reps === 1 ? 'Single' : `${r.reps}+ reps`}</span><strong>{r.weight} lb</strong><small>{shortDate(r.timestamp)}</small></div>
          ))}
        </div>
      </>)}

      {review && (<>
        <div className="workout-section-title">Last session vs plan</div>
        <div className="an-review">
          <div><span>Target effort</span><strong>RIR {review.targetRir}</strong></div>
          <div><span>Predicted</span><strong>{review.predictedRir < 0 ? 'Past failure' : `RIR ${review.predictedRir.toFixed(1)}`}</strong></div>
          <div><span>Logged</span><strong>RIR {review.actualRir.toFixed(1)}{review.actualRirAssumed ? '*' : ''}</strong></div>
          <div><span>Strength vs expected</span><strong className={review.achievedGain >= review.expectedGain ? 'is-up' : 'is-down'}>{review.achievedGain >= 0 ? '+' : ''}{(review.achievedGain * 100).toFixed(1)}% <small>vs {(review.expectedGain * 100).toFixed(1)}%</small></strong></div>
        </div>
        <p className="workout-hint">Lower logged RIR than predicted means it felt harder than the engine expected; the next suggestion adjusts for that.{review.actualRirAssumed ? ' *RIR assumed from planned reps.' : ''}</p>
      </>)}

      <div className="workout-section-title">Recent sessions</div>
      <div className="workout-stack">
        {recent.map((s) => (
          <div key={s.timestamp} className="an-session">
            <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
              <strong>{new Date(s.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{s.pr ? ' 🏆' : ''}</strong>
              <span className="workout-hint">{Math.round(s.e1rm)} est. 1RM</span>
            </div>
            <span className="workout-hint">
              {s.sets.map((set) => `${set.weight}×${set.reps}${typeof set.rir === 'number' ? ` @${rirLabel(set.rir)}` : ''}`).join(' · ')}{s.gymName ? ` · ${s.gymName}` : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="workout-hint" style={{ marginTop: '1rem' }}>Same exercise under different names? Merge them in Configuration → Your exercises.</p>
    </Sheet>
  );
}
