'use client';

import { useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import SetEditSheet, { rirLabel, type LoggedSet } from '@/components/workout/SetEditSheet';
import type { Workout } from '@/lib/workout/insights';
import { enqueueChange, isRetryableSaveFailure } from '@/lib/workout/offline-queue';

type EditWorkoutSheetProps = {
  workout: Workout;
  liftName: (liftId: string) => string;
  /** Weights the lift's machine can do, for the − / + buttons. */
  weightsFor: (liftId: string) => number[];
  ownerId?: string;
  /** `queued`: no signal, so the change is kept on this phone to send later. */
  onSaved: (workout: Workout, queued?: boolean) => void;
  onClose: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → the value a datetime-local input wants (local time, no seconds). */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Fix a saved workout: tap a set to change it, add a missed one, or change when it was. */
export default function EditWorkoutSheet({ workout, liftName, weightsFor, ownerId, onSaved, onClose }: EditWorkoutSheetProps) {
  const [logs, setLogs] = useState<Record<string, LoggedSet[]>>(() =>
    Object.fromEntries(Object.entries(workout.logs || {}).map(([id, sets]) => [id, (sets || []).map((s) => ({ ...s }))])));
  const [editing, setEditing] = useState<{ liftId: string; index: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(workout.timestamp));
  const [minutes, setMinutes] = useState(workout.durationSecs ? String(Math.round(workout.durationSecs / 60)) : '');
  const [notes, setNotes] = useState(workout.notes || '');
  const whenChanged = when !== toLocalInput(workout.timestamp);
  const minutesChanged = minutes !== (workout.durationSecs ? String(Math.round(workout.durationSecs / 60)) : '');
  const notesChanged = notes.trim() !== (workout.notes || '');
  const anyChange = changed || whenChanged || minutesChanged || notesChanged;
  const setCount = Object.values(logs).reduce((n, sets) => n + sets.length, 0);

  const update = (liftId: string, sets: LoggedSet[]) => {
    setLogs((prev) => ({ ...prev, [liftId]: sets }));
    setChanged(true);
  };
  const addSet = (liftId: string) => {
    const sets = logs[liftId] || [];
    const last = sets[sets.length - 1];
    update(liftId, [...sets, { weight: last?.weight ?? 0, reps: last?.reps ?? 0, ...(typeof last?.rir === 'number' ? { rir: last.rir } : {}) }]);
    setEditing({ liftId, index: sets.length });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const body = {
      ...(changed ? { logs } : {}),
      ...(whenChanged && when ? { timestamp: new Date(when).toISOString() } : {}),
      ...(minutesChanged && minutes !== '' ? { durationSecs: Math.max(0, Number(minutes)) * 60 } : {}),
      ...(notesChanged ? { notes } : {}),
    };
    // What the workout looks like after the change, if it has to wait for signal.
    const preview: Workout = {
      ...workout,
      ...(changed ? { logs } : {}),
      ...(body.timestamp ? { timestamp: body.timestamp } : {}),
      ...(body.durationSecs !== undefined ? { durationSecs: body.durationSecs } : {}),
      ...(notesChanged ? { notes: notes.trim() || undefined } : {}),
    };
    const queue = () => {
      if (!ownerId) return false;
      enqueueChange(ownerId, { id: workout.id!, kind: 'edit', body, preview });
      onSaved(preview, true);
      return true;
    };
    let res: Response;
    try {
      res = await fetch(`/api/workout/history?id=${encodeURIComponent(workout.id!)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      if (queue()) return;
      setError('No connection — try again when you have signal.');
      setSaving(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) { onSaved(data.workout); return; }
    if (isRetryableSaveFailure(res.status) && queue()) return;
    setError(data.error || data.message || 'Could not save the changes');
    setSaving(false);
  };

  const current = editing ? logs[editing.liftId]?.[editing.index] : undefined;

  return (
    <Sheet
      title="Edit workout"
      subtitle={`${workout.type?.name || workout.name || 'Workout'} · ${new Date(workout.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="workout-button" onClick={onClose}>Cancel</button>
        <button type="button" className="workout-button is-primary" disabled={!anyChange || saving || setCount === 0} onClick={save}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </>}
    >
      <div className="an-edit-when">
        <label>
          <span className="workout-label">Date &amp; time</span>
          <input className="workout-input" type="datetime-local" value={when} max={toLocalInput(new Date().toISOString())} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label>
          <span className="workout-label">Minutes</span>
          <input className="workout-input" type="number" inputMode="numeric" min={0} max={600} value={minutes} placeholder="—" onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        <span className="workout-label">Notes</span>
        <textarea className="workout-input" rows={2} maxLength={500} value={notes} placeholder="How it felt, anything to remember" onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="workout-hint" style={{ marginTop: 0 }}>Tap a set to fix its weight, reps or effort.</p>
      <div className="workout-stack">
        {Object.entries(logs).map(([liftId, sets]) => (
          <div key={liftId} className="an-edit-lift">
            <strong>{liftName(liftId)}</strong>
            <div className="an-set-chips">
              {sets.map((set, i) => (
                <button key={i} type="button" className="an-set-chip" onClick={() => setEditing({ liftId, index: i })}>
                  <small>{i + 1}</small> {set.weight}×{set.reps}{typeof set.rir === 'number' ? ` @${rirLabel(set.rir)}` : ''}
                </button>
              ))}
              <button type="button" className="an-set-chip is-add" onClick={() => addSet(liftId)}>+ Set</button>
            </div>
            {sets.length === 0 && <span className="workout-hint">No sets — this lift will be removed.</span>}
          </div>
        ))}
      </div>
      {setCount === 0 && <p className="workout-error">A workout needs at least one set. Delete the workout instead.</p>}
      {error && <p className="workout-error">{error}</p>}

      {editing && current && (
        <SetEditSheet
          set={current}
          setNumber={editing.index + 1}
          liftName={liftName(editing.liftId)}
          possibleWeights={weightsFor(editing.liftId)}
          onSave={(set) => {
            update(editing.liftId, logs[editing.liftId].map((s, i) => (i === editing.index ? set : s)));
            setEditing(null);
          }}
          onDelete={() => {
            update(editing.liftId, logs[editing.liftId].filter((_, i) => i !== editing.index));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Sheet>
  );
}
