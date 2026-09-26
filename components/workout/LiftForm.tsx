'use client';

import { useState } from 'react';
import {
  EMPTY_LIFT,
  MUSCLE_OPTIONS_WITH_NONE,
  PROGRESSION_PROFILE_OPTIONS,
  type Lift,
  type ProgressionProfile,
  type Station,
} from '@/lib/workout/types';
import { finalizeLift } from '@/lib/workout/stations';
import { CATALOG_LIFT_NAMES, inferLiftDetails } from '@/lib/workout/catalog';

type LiftFormProps = {
  station: Station;
  /** Existing lift to edit; omit to create a new one. */
  initial?: Lift;
  saving?: boolean;
  onSave: (lift: Lift) => void | Promise<void>;
  onCancel: () => void;
};

/** Create/edit form for a lift on a station, shared by the config page and the in-workout editor. */
export default function LiftForm({ station, initial, saving = false, onSave, onCancel }: LiftFormProps) {
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

  const handleSave = () => {
    if (!draft.name?.trim()) return;
    onSave(finalizeLift(draft));
  };

  return (
    <div className="workout-form-panel animate-fade-in" style={{ marginTop: '0.5rem' }}>
      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>{initial ? 'Edit Lift' : 'New Lift'}</h4>
      <input className="workout-input" placeholder="Lift name (e.g. Bench Press)" list="lift-catalog-names" autoComplete="off" value={draft.name || ''} onChange={(e) => updateName(e.target.value)} />
      <datalist id="lift-catalog-names">
        {CATALOG_LIFT_NAMES.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div className="workout-grid-2">
        <div>
          <label className="workout-label">Primary Muscle</label>
          <select className="workout-input" value={draft.primaryMuscle} onChange={(e) => updateDetail({ primaryMuscle: e.target.value })}>
            {MUSCLE_OPTIONS_WITH_NONE.filter((m) => m !== 'None').map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="workout-label">Secondary Muscle</label>
          <select className="workout-input" value={draft.secondaryMuscle} onChange={(e) => updateDetail({ secondaryMuscle: e.target.value })}>
            {MUSCLE_OPTIONS_WITH_NONE.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <label className="workout-label">Progression Profile</label>
      <select className="workout-input" value={draft.progressionProfile || 'standard'} onChange={(e) => updateDetail({ progressionProfile: e.target.value as ProgressionProfile })}>
        {PROGRESSION_PROFILE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      {attachments.length > 0 && (
        <>
          <label className="workout-label">Attachment</label>
          <select className="workout-input" value={draft.attachment || ''} onChange={(e) => update({ attachment: e.target.value || undefined })}>
            <option value="">None</option>
            {attachments.map((att) => <option key={att} value={att}>{att}</option>)}
          </select>
        </>
      )}

      <label className="workout-label">Setup Notes (optional)</label>
      <input
        className="workout-input"
        placeholder="e.g. seat 4, pin 3, neutral grip"
        maxLength={200}
        value={draft.notes || ''}
        onChange={(e) => update({ notes: e.target.value })}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '1rem' }}>
        <input type="checkbox" checked={draft.singleArmLeg === true} onChange={(e) => updateDetail({ singleArmLeg: e.target.checked })} />
        Single Arm / Leg variation
      </label>

      <div className="workout-btn-row">
        <button className="workout-btn-primary" disabled={!draft.name?.trim() || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Lift'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
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
