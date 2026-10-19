'use client';

import { useMemo, useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import type { Workout } from '@/lib/workout/insights';
import { compareWorkouts, defaultComparison } from '@/lib/workout/workout-compare';

type CompareSheetProps = {
  workout: Workout;
  history: Workout[];
  lifts: Record<string, { name?: string; exercise?: string }>;
  onClose: () => void;
};

const typeOf = (w: Workout) => w.type?.name || w.name || 'Workout';
const day = (w: Workout, weekday = false) => new Date(w.timestamp).toLocaleDateString(undefined, { ...(weekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric' });

/** This workout and another side by side, lift by lift. */
export default function CompareSheet({ workout, history, lifts, onClose }: CompareSheetProps) {
  const others = useMemo(() => history
    .filter((w) => w !== workout && w.id !== workout.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [history, workout]);
  const [otherId, setOtherId] = useState(() => defaultComparison(workout, history)?.id || others[0]?.id || '');
  const other = others.find((w) => w.id === otherId);
  // Newer on the left, so changes read as progress.
  const [a, b] = other && new Date(other.timestamp) > new Date(workout.timestamp) ? [other, workout] : [workout, other];
  const result = useMemo(() => (a && b ? compareWorkouts(a, b, lifts) : null), [a, b, lifts]);

  return (
    <Sheet title="Compare workouts" subtitle={`${typeOf(workout)} · ${day(workout, true)}`} onClose={onClose}>
      {others.length === 0 ? <p className="workout-hint">There’s no other workout to compare with yet.</p> : (<>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <span className="workout-label">Compare with</span>
          <select className="workout-input" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
            {others.map((w) => (
              <option key={w.id} value={w.id}>{typeOf(w)} · {day(w, true)}{w.gymName ? ` · ${w.gymName}` : ''}</option>
            ))}
          </select>
        </label>

        {result && a && b && (
          <table className="an-compare">
            <thead>
              <tr><th /><th>{day(a)}</th><th>{day(b)}</th><th aria-label="Change" /></tr>
            </thead>
            <tbody>
              {result.totals.map((t) => (
                <tr key={t.label} className="is-total">
                  <th scope="row">{t.label}</th>
                  <td>{t.a ? t.a.toLocaleString() : '—'}</td>
                  <td>{t.b ? t.b.toLocaleString() : '—'}</td>
                  <td className={t.a > t.b ? 'is-up' : t.a < t.b ? 'is-down' : ''}>{t.a && t.b && t.a !== t.b ? `${t.a > t.b ? '▲' : '▼'}` : ''}</td>
                </tr>
              ))}
              {result.lifts.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.name}</th>
                  <td>{row.a ? <>{row.a.top.weight}×{row.a.top.reps}<small>{row.a.sets} sets</small></> : '—'}</td>
                  <td>{row.b ? <>{row.b.top.weight}×{row.b.top.reps}<small>{row.b.sets} sets</small></> : '—'}</td>
                  <td className={row.change === null ? '' : row.change > 0 ? 'is-up' : row.change < 0 ? 'is-down' : ''}>
                    {row.change === null ? (row.a ? 'new' : '') : row.change === 0 ? '=' : `${row.change > 0 ? '+' : ''}${row.change}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="workout-hint">Best set of each lift; the last column is the change in estimated 1RM (lb). Lifts match by exercise, so the same one at another gym lines up.</p>
      </>)}
    </Sheet>
  );
}
