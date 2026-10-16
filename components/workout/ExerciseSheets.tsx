'use client';

import { useState } from 'react';
import Sheet from './Sheet';
import type { Exercise } from '@/lib/workout/exercises';

type ExerciseSheetProps = {
  exercise: Exercise;
  /** Your other exercises (merge targets). */
  others: Exercise[];
  busy: boolean;
  error: string;
  onRename: (to: string) => void;
  onMerge: (into: string) => void;
  onClose: () => void;
};

/** One exercise: where it's set up, rename it everywhere, or merge it into another. */
export function ExerciseSheet({ exercise, others, busy, error, onRename, onMerge, onClose }: ExerciseSheetProps) {
  const [name, setName] = useState(exercise.name);
  const [into, setInto] = useState('');
  const renamed = name.trim() && name.trim() !== exercise.name;
  return (
    <Sheet title={exercise.name} subtitle={`${exercise.uses.length} place${exercise.uses.length === 1 ? '' : 's'}`} onClose={onClose}>
      {error && <p className="workout-error">{error}</p>}
      <div className="workout-section-title" style={{ marginTop: 0 }}>Set up at</div>
      <div className="workout-stack" style={{ marginBottom: '1rem' }}>
        {exercise.uses.map((use) => (
          <div key={use.liftId} className="workout-lift-row" style={{ cursor: 'default' }}>
            <span className="workout-card-text">
              <span className="workout-card-title">{use.gymName}</span>
              <span className="workout-card-meta">{use.stationName}{use.liftName !== exercise.name ? ` · as “${use.liftName}”` : ''}</span>
            </span>
          </div>
        ))}
      </div>

      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Rename everywhere</span>
        <input className="workout-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="workout-button is-primary is-block" disabled={!renamed || busy} onClick={() => onRename(name.trim())}>
        {busy ? 'Saving…' : 'Rename in every gym and workout'}
      </button>

      {others.length > 0 && (<>
        <div className="workout-section-title">Same exercise as…</div>
        <p className="workout-hint" style={{ marginTop: 0 }}>Merge it into another exercise: every lift and past workout moves over, keeping its history.</p>
        <select className="workout-input" value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">Pick an exercise</option>
          {others.map((other) => <option key={other.key} value={other.name}>{other.name}</option>)}
        </select>
        <button className="workout-button is-block" disabled={!into || busy} onClick={() => onMerge(into)}>Merge into {into || '…'}</button>
      </>)}
    </Sheet>
  );
}

type MergeSheetProps = {
  group: Exercise[];
  busy: boolean;
  error: string;
  onMerge: (from: string[], to: string) => void;
  onClose: () => void;
};

/** Likely duplicates: pick the name to keep and merge them. */
export function MergeDuplicatesSheet({ group, busy, error, onMerge, onClose }: MergeSheetProps) {
  const [keep, setKeep] = useState(group.reduce((best, e) => (e.uses.length > best.uses.length ? e : best), group[0]).name);
  return (
    <Sheet
      title="Same exercise?"
      subtitle="These look like one exercise under different names"
      onClose={onClose}
      footer={<button className="workout-button is-primary" disabled={busy} onClick={() => onMerge(group.map((e) => e.name), keep)}>{busy ? 'Merging…' : `Merge as “${keep}”`}</button>}
    >
      {error && <p className="workout-error">{error}</p>}
      <span className="workout-label">Keep the name</span>
      <div className="workout-stack" role="radiogroup" aria-label="Name to keep">
        {group.map((exercise) => (
          <button key={exercise.key} type="button" role="radio" aria-checked={keep === exercise.name} className="workout-choice is-row" onClick={() => setKeep(exercise.name)}>
            <span aria-hidden>{keep === exercise.name ? '◉' : '○'}</span>
            <span className="workout-card-text">
              <span className="workout-card-title">{exercise.name}</span>
              <small style={{ display: 'block' }}>{exercise.uses.map((u) => `${u.gymName} · ${u.stationName}`).join('; ')}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="workout-hint">Every lift and past workout moves to the kept name, so their history, PRs and goals combine. Not the same? Just close this.</p>
    </Sheet>
  );
}
