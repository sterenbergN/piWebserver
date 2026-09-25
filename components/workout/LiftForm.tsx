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
  const update = (patch: Partial<Lift>) => setDraft((prev) => ({ ...prev, ...patch }));
  const attachments = station.type === 'cable' ? station.attachments || [] : [];

  const handleSave = () => {
    if (!draft.name?.trim()) return;
    onSave(finalizeLift(draft));
  };

  return (
    <div className="workout-form-panel animate-fade-in" style={{ marginTop: '0.5rem' }}>
      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>{initial ? 'Edit Lift' : 'New Lift'}</h4>
      <input className="workout-input" placeholder="Lift name (e.g. Bench Press)" value={draft.name || ''} onChange={(e) => update({ name: e.target.value })} />

      <div className="workout-grid-2">
        <div>
          <label className="workout-label">Primary Muscle</label>
          <select className="workout-input" value={draft.primaryMuscle} onChange={(e) => update({ primaryMuscle: e.target.value })}>
            {MUSCLE_OPTIONS_WITH_NONE.filter((m) => m !== 'None').map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="workout-label">Secondary Muscle</label>
          <select className="workout-input" value={draft.secondaryMuscle} onChange={(e) => update({ secondaryMuscle: e.target.value })}>
            {MUSCLE_OPTIONS_WITH_NONE.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <label className="workout-label">Progression Profile</label>
      <select className="workout-input" value={draft.progressionProfile || 'standard'} onChange={(e) => update({ progressionProfile: e.target.value as ProgressionProfile })}>
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

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '1rem' }}>
        <input type="checkbox" checked={draft.singleArmLeg === true} onChange={(e) => update({ singleArmLeg: e.target.checked })} />
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
