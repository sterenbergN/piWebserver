'use client';

import { useState } from 'react';
import {
  EMPTY_LIFT,
  MUSCLE_OPTIONS_WITH_NONE,
  type Lift,
  type ProgressionProfile,
  type Station,
} from '@/lib/workout/types';
import { finalizeLift } from '@/lib/workout/stations';
import { CATALOG_LIFT_NAMES, inferLiftDetails } from '@/lib/workout/catalog';
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
};

/** Create/edit sheet for a lift on a station, shared by the config page and the in-workout editor. */
export default function LiftForm({ station, initial, saving = false, onSave, onCancel, onDelete }: LiftFormProps) {
  const [draft, setDraft] = useState<Partial<Lift>>(() => ({ ...EMPTY_LIFT, ...initial }));
  // Once the muscles/profile are picked by hand, stop overwriting them from the name.
  const [detailsTouched, setDetailsTouched] = useState(!!initial);
  const update = (patch: Partial<Lift>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateDetail = (patch: Partial<Lift>) => { setDetailsTouched(true); update(patch); };
  const updateName = (name: string) => {
    const inferred = detailsTouched ? undefined : inferLiftDetails(name);
    if (!inferred) return update({ name });
    const { known: _known, ...details } = inferred;
    update({ name, ...details });
  };
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
          {CATALOG_LIFT_NAMES.map((n) => <option key={n} value={n} />)}
        </datalist>
      </label>

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

/** One-line summary of a lift's muscles / variation / attachment. */
export function describeLift(lift: Lift) {
  const parts = [lift.primaryMuscle];
  if (lift.secondaryMuscle && lift.secondaryMuscle !== 'None') parts.push(lift.secondaryMuscle);
  if (lift.singleArmLeg) parts.push('Single limb');
  if (lift.attachment) parts.push(lift.attachment);
  if (lift.progressionProfile && lift.progressionProfile !== 'standard') parts.push(lift.progressionProfile);
  return parts.join(' • ');
}
