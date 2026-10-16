'use client';

import { useMemo, useState } from 'react';
import Sheet from './Sheet';
import { formatProjection, goalProgress, type Goal } from '@/lib/workout/goals';
import type { Exercise } from '@/lib/workout/exercises';

type GoalsCardProps = {
  goals: Goal[];
  history: any[];
  exercises: Exercise[];
  /** Saves (creates when no id) and returns the stored goal. */
  onSave: (goal: Partial<Goal>) => Promise<void>;
  onDelete: (goal: Goal) => Promise<void>;
};

type Draft = { id?: string; exercise: string; targetWeight: string; targetReps: string; deadline: string };

/** Goals per exercise with progress and a projected date. */
export default function GoalsCard({ goals, history, exercises, onSave, onDelete }: GoalsCardProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => goals
    .map((goal) => ({ goal, progress: goalProgress(goal, history) }))
    .sort((a, b) => Number(a.progress.achieved) - Number(b.progress.achieved) || b.progress.fraction - a.progress.fraction), [goals, history]);

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ id: draft.id, exercise: draft.exercise, targetWeight: Number(draft.targetWeight), targetReps: Number(draft.targetReps) || 1, deadline: draft.deadline || undefined });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the goal.');
    } finally {
      setSaving(false);
    }
  };

  const open = (goal?: Goal) => {
    setError('');
    setDraft(goal
      ? { id: goal.id, exercise: goal.exercise, targetWeight: String(goal.targetWeight), targetReps: String(goal.targetReps), deadline: goal.deadline || '' }
      : { exercise: exercises[0]?.name || '', targetWeight: '', targetReps: '1', deadline: '' });
  };

  return (
    <div className="workout-tile" style={{ marginTop: '1rem' }}>
      <div className="workout-flex-between" style={{ marginBottom: rows.length ? '0.75rem' : 0 }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Goals</h3>
        <button className="workout-button is-small" disabled={exercises.length === 0} onClick={() => open()}>+ Goal</button>
      </div>
      {rows.length === 0 && <p className="workout-hint" style={{ margin: '0.4rem 0 0' }}>Set a target like “Bench Press 225 × 1” and see how close you are and when you’ll get there.</p>}
      <div className="workout-stack">
        {rows.map(({ goal, progress }) => (
          <button key={goal.id} type="button" className="workout-goal" onClick={() => open(goal)}>
            <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
              <strong>{progress.achieved ? '✅ ' : ''}{goal.exercise} {goal.targetWeight} × {goal.targetReps}</strong>
              <span className="workout-hint" style={{ flexShrink: 0 }}>{Math.round(progress.fraction * 100)}%</span>
            </div>
            <div className="workout-goal-bar"><div style={{ width: `${Math.round(progress.fraction * 100)}%`, background: progress.achieved ? 'var(--success)' : progress.behind ? 'var(--warning)' : 'var(--accent)' }} /></div>
            <span className="workout-hint">
              {progress.currentE1RM > 0 ? `Est. 1RM ${Math.round(progress.currentE1RM)} of ${Math.round(progress.targetE1RM)} lbs · ` : ''}
              {formatProjection(progress)}
              {goal.deadline && !progress.achieved ? ` · target ${new Date(`${goal.deadline}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${progress.behind ? ' (behind)' : ''}` : ''}
            </span>
          </button>
        ))}
      </div>

      {draft && (
        <Sheet
          title={draft.id ? 'Edit goal' : 'New goal'}
          onClose={() => setDraft(null)}
          footer={<button className="workout-button is-primary" disabled={saving || !draft.exercise || !(Number(draft.targetWeight) > 0)} onClick={submit}>{saving ? 'Saving…' : 'Save goal'}</button>}
        >
          {error && <p className="workout-error">{error}</p>}
          <label className="workout-field" style={{ display: 'block' }}>
            <span className="workout-label">Exercise</span>
            <select className="workout-input" value={draft.exercise} onChange={(e) => setDraft({ ...draft, exercise: e.target.value })}>
              {!exercises.some((e) => e.name === draft.exercise) && draft.exercise && <option value={draft.exercise}>{draft.exercise}</option>}
              {exercises.map((e) => <option key={e.key} value={e.name}>{e.name}</option>)}
            </select>
          </label>
          <div className="workout-grid-2 workout-field">
            <label>
              <span className="workout-label">Weight (lbs)</span>
              <input className="workout-input" inputMode="decimal" placeholder="225" value={draft.targetWeight} onChange={(e) => setDraft({ ...draft, targetWeight: e.target.value })} />
            </label>
            <label>
              <span className="workout-label">Reps</span>
              <input className="workout-input" inputMode="numeric" placeholder="1" value={draft.targetReps} onChange={(e) => setDraft({ ...draft, targetReps: e.target.value })} />
            </label>
          </div>
          <label className="workout-field" style={{ display: 'block' }}>
            <span className="workout-label">By (optional)</span>
            <input className="workout-input" type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </label>
          <p className="workout-hint">Progress uses your best estimated 1RM from recent sessions, at any gym. The goal is reached when you log a set at the weight for the reps.</p>
          {draft.id && (
            <button type="button" className="workout-button is-danger is-block" onClick={async () => { await onDelete(goals.find((g) => g.id === draft.id)!); setDraft(null); }}>Delete goal</button>
          )}
        </Sheet>
      )}
    </div>
  );
}
