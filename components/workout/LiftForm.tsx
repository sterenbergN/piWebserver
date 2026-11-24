'use client';

import { useState } from 'react';
import {
  EMPTY_LIFT,
  MUSCLE_OPTIONS_WITH_NONE,
  type Lift,
  type ProgressionProfile,
  type Station,
  type WarmupPlan,
} from '@/lib/workout/types';
import { finalizeLift } from '@/lib/workout/stations';
import { CATALOG_LIFT_NAMES, inferLiftDetails } from '@/lib/workout/catalog';
import { exerciseKeyFromName, type Exercise } from '@/lib/workout/exercises';
import Sheet from './Sheet';

const PROFILES: { value: ProgressionProfile; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: 'Adds weight first' },
  { value: 'high-rep', label: 'High-rep', hint: 'Adds reps first (12–30)' },
  { value: 'endurance', label: 'Endurance', hint: 'Builds volume first' },
];

type LiftFormProps = {
  station: Station;
  /** Existing lift to edit; omit to create a new one. */
  initial?: Lift;
  saving?: boolean;
  onSave: (lift: Lift) => void | Promise<void>;
  onCancel: () => void;
  /** Shown as a delete button when editing. */
  onDelete?: () => void;
  /** Your exercises (from all your gyms), for "counts as" and name suggestions. */
  exercises?: Exercise[];
};

/** Create/edit sheet for a lift on a station, shared by the config page and the in-workout editor. */
export default function LiftForm({ station, initial, saving = false, onSave, onCancel, onDelete, exercises = [] }: LiftFormProps) {
  const [draft, setDraft] = useState<Partial<Lift>>(() => ({ ...EMPTY_LIFT, ...initial }));
  // Once the muscles/profile are picked by hand, stop overwriting them from the name.
  const [detailsTouched, setDetailsTouched] = useState(!!initial);
  // Once "counts as" is picked by hand, renaming no longer changes it.
  const [exerciseTouched, setExerciseTouched] = useState(false);
  const update = (patch: Partial<Lift>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateDetail = (patch: Partial<Lift>) => { setDetailsTouched(true); update(patch); };
  const updateName = (name: string) => {
    // Renaming keeps the lift's history: it still counts as the exercise it was.
    const keepHistory = initial && !initial.exercise && !exerciseTouched ? { exercise: initial.name } : {};
    const own = exercises.find((e) => e.key === exerciseKeyFromName(name));
    const inferred = detailsTouched ? undefined : own
      ? { primaryMuscle: own.primaryMuscle, secondaryMuscle: own.secondaryMuscle, singleArmLeg: own.singleArmLeg, progressionProfile: own.progressionProfile }
      : inferLiftDetails(name);
    if (!inferred) return update({ name, ...keepHistory });
    const { known: _known, ...details } = inferred as Partial<Lift> & { known?: boolean };
    update({ name, ...keepHistory, ...details });
  };
  const chooseExercise = (value: string) => {
    setExerciseTouched(true);
    const picked = exercises.find((e) => e.name === value);
    // A new lift takes on your details for that exercise unless you've set them.
    const details = picked && !detailsTouched
      ? { primaryMuscle: picked.primaryMuscle, secondaryMuscle: picked.secondaryMuscle, singleArmLeg: picked.singleArmLeg, progressionProfile: picked.progressionProfile }
      : {};
    update({ exercise: value || undefined, ...details });
  };
  const nameKey = exerciseKeyFromName(draft.name || '');
  const exerciseOptions = exercises.filter((e) => e.key !== nameKey && !(initial && e.uses.length === 1 && e.uses[0].liftId === initial.id));
  if (draft.exercise && !exerciseOptions.some((e) => e.name === draft.exercise) && exerciseKeyFromName(draft.exercise) !== nameKey) {
    exerciseOptions.unshift({ key: exerciseKeyFromName(draft.exercise), name: draft.exercise, uses: [] } as unknown as Exercise);
  }
  const ownMatch = exercises.find((e) => e.key === nameKey && !(initial && e.uses.every((u) => u.liftId === initial.id)));
  const countsAs = draft.exercise && exerciseKeyFromName(draft.exercise) !== nameKey ? draft.exercise : '';
  const attachments = station.type === 'cable' ? station.attachments || [] : [];
  const profile = draft.progressionProfile || 'standard';

  const handleSave = () => {
    if (!draft.name?.trim()) return;
    onSave(finalizeLift(draft));
  };

  return (
    <Sheet
      title={initial ? `Edit ${initial.name}` : 'New lift'}
      subtitle={`On ${station.name}`}
      onClose={onCancel}
      footer={<button className="workout-button is-primary" disabled={!draft.name?.trim() || saving} onClick={handleSave}>{saving ? 'Saving…' : initial ? 'Save lift' : 'Add lift'}</button>}
    >
      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Name</span>
        <input className="workout-input" placeholder="e.g. Bench Press" list="lift-catalog-names" autoComplete="off" autoFocus={!initial}
          value={draft.name || ''} onChange={(e) => updateName(e.target.value)} />
        <datalist id="lift-catalog-names">
          {[...new Set([...exercises.map((e) => e.name), ...CATALOG_LIFT_NAMES])].map((n) => <option key={n} value={n} />)}
        </datalist>
      </label>

      {(exerciseOptions.length > 0 || countsAs) && (
        <label className="workout-field" style={{ display: 'block' }}>
          <span className="workout-label">Counts as</span>
          <select className="workout-input" value={countsAs} onChange={(e) => chooseExercise(e.target.value)}>
            <option value="">{draft.name?.trim() ? `Its own exercise (${draft.name.trim()})` : 'Its own exercise'}</option>
            {exerciseOptions.map((e) => (
              <option key={e.key} value={e.name}>
                {e.name}{e.uses.length ? ` — ${e.uses.map((u) => u.gymName).filter((g, i, all) => all.indexOf(g) === i).join(', ')}` : initial ? ' — keeps its history' : ''}
              </option>
            ))}
          </select>
          <span className="workout-hint" style={{ display: 'block', marginTop: '0.3rem' }}>
            Lifts that count as the same exercise share history, PRs and plateau checks across your gyms.
          </span>
        </label>
      )}
      {!countsAs && ownMatch && (
        <p className="workout-hint" style={{ margin: '-0.4rem 0 0.9rem' }}>
          🔗 Shares history with {ownMatch.name} at {[...new Set(ownMatch.uses.map((u) => u.gymName))].join(', ')}.
        </p>
      )}

      <div className="workout-grid-2 workout-field">
        <label>
          <span className="workout-label">Main muscle</span>
          <select className="workout-input" value={draft.primaryMuscle} onChange={(e) => updateDetail({ primaryMuscle: e.target.value })}>
            {MUSCLE_OPTIONS_WITH_NONE.filter((m) => m !== 'None').map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <span className="workout-label">Also works</span>
          <select className="workout-input" value={draft.secondaryMuscle} onChange={(e) => updateDetail({ secondaryMuscle: e.target.value })}>
            {MUSCLE_OPTIONS_WITH_NONE.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="workout-field">
        <span className="workout-label">How it progresses</span>
        <div className="workout-segmented">
          {PROFILES.map((p) => (
            <button key={p.value} type="button" aria-pressed={profile === p.value} onClick={() => updateDetail({ progressionProfile: p.value })}>{p.label}</button>
          ))}
        </div>
        <div className="workout-hint" style={{ marginTop: '0.3rem' }}>{PROFILES.find((p) => p.value === profile)?.hint}</div>
      </div>

      {attachments.length > 0 && (
        <div className="workout-field">
          <span className="workout-label">Attachment</span>
          <div className="workout-chip-list">
            {['', ...attachments].map((att) => (
              <button key={att || 'none'} type="button" className="workout-toggle-chip" aria-pressed={(draft.attachment || '') === att} onClick={() => update({ attachment: att || undefined })}>
                {att || 'None'}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="workout-switch-row">
        <span>
          <strong style={{ display: 'block', fontSize: '0.92rem' }}>One arm / leg at a time</strong>
          <span className="workout-hint">Single-arm or single-leg version</span>
        </span>
        <input type="checkbox" checked={draft.singleArmLeg === true} onChange={(e) => updateDetail({ singleArmLeg: e.target.checked })} />
      </label>

      <WarmupEditor station={station} plan={draft.warmup} onChange={(warmup) => update({ warmup })} />

      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Setup notes (optional)</span>
        <input className="workout-input" placeholder="e.g. seat 4, pin 3, neutral grip" maxLength={200} value={draft.notes || ''} onChange={(e) => update({ notes: e.target.value })} />
      </label>

      {initial && onDelete && (
        <button type="button" className="workout-button is-danger is-block" style={{ marginTop: '0.5rem' }} onClick={onDelete}>Delete this lift</button>
      )}
    </Sheet>
  );
}

/**
 * How this lift is warmed up: the usual ramp, none, or your own sets. On plate-loaded
 * equipment each set is plates per side (45 for one 45, 90 for two), added to the bar
 * or sled; elsewhere it's the total weight. Reps left blank use the day's reps.
 */
function WarmupEditor({ station, plan, onChange }: { station: Station; plan?: WarmupPlan; onChange: (plan: WarmupPlan | undefined) => void }) {
  const kind = plan?.kind ?? 'ramp';
  const perSide = station.type === 'plates';
  const base = station.baseWeight ?? 0;
  const sets = plan?.kind === 'sets' ? plan.sets : [];
  const setAt = (i: number, patch: { perSide?: number; weight?: number; reps?: number }) =>
    onChange({ kind: 'sets', sets: sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v)) || undefined);
  return (
    <div className="workout-field">
      <span className="workout-label">Warm-up</span>
      <select className="workout-input" value={kind} onChange={(e) => {
        const next = e.target.value;
        if (next === 'ramp') onChange(undefined);
        else if (next === 'none') onChange({ kind: 'none' });
        else onChange({ kind: 'sets', sets: sets.length ? sets : [perSide ? { perSide: 45 } : { weight: Math.round(base || 20) }] });
      }}>
        <option value="ramp">The usual ramp (3 lighter sets)</option>
        <option value="sets">My own warm-up sets</option>
        <option value="none">No warm-up</option>
      </select>
      {kind === 'sets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.45rem' }}>
          {sets.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <input className="workout-input" style={{ width: '6.5rem' }} type="number" inputMode="decimal" min={0} step={2.5}
                aria-label={perSide ? `Set ${i + 1}: pounds per side` : `Set ${i + 1}: weight`}
                value={(perSide ? s.perSide : s.weight) ?? ''}
                onChange={(e) => setAt(i, perSide ? { perSide: num(e.target.value), weight: undefined } : { weight: num(e.target.value), perSide: undefined })} />
              <span className="workout-hint">{perSide ? `lb a side${s.perSide ? ` (${base + 2 * s.perSide} lb)` : ''}` : 'lb'} ×</span>
              <input className="workout-input" style={{ width: '5.5rem' }} type="number" inputMode="numeric" min={1} placeholder="day’s" aria-label={`Set ${i + 1}: reps`}
                value={s.reps ?? ''} onChange={(e) => setAt(i, { reps: num(e.target.value) })} />
              <span className="workout-hint">reps</span>
              <button type="button" className="workout-text-btn" aria-label={`Remove warm-up set ${i + 1}`} onClick={() => onChange(sets.length > 1 ? { kind: 'sets', sets: sets.filter((_, j) => j !== i) } : { kind: 'none' })}>✕</button>
            </div>
          ))}
          {sets.length < 4 && (
            <button type="button" className="workout-text-btn" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ kind: 'sets', sets: [...sets, perSide ? { perSide: (sets.at(-1)?.perSide ?? 0) + 45 } : { weight: (sets.at(-1)?.weight ?? 0) + 10 }] })}>+ Add a warm-up set</button>
          )}
          <span className="workout-hint">{perSide ? `Per side${base > 0 ? `, on the ${base} lb ${base >= 70 ? 'sled' : 'bar'}` : ''}: 45 is one plate a side, 90 two. ` : ''}Blank reps use the day’s reps. A set as heavy as the working weight is skipped.</span>
        </div>
      )}
    </div>
  );
}

/** One-line summary of a lift's muscles / variation / attachment. */
export function describeLift(lift: Lift) {
  const parts = [lift.primaryMuscle];
  if (lift.secondaryMuscle && lift.secondaryMuscle !== 'None') parts.push(lift.secondaryMuscle);
  if (lift.singleArmLeg) parts.push('Single limb');
  if (lift.attachment) parts.push(lift.attachment);
  if (lift.progressionProfile && lift.progressionProfile !== 'standard') parts.push(lift.progressionProfile);
  return parts.join(' • ');
}
