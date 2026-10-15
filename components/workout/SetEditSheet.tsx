'use client';

import { useState } from 'react';
import { stepWeight } from '@/lib/workout/equipment';
import Sheet from './Sheet';
import StepperInput from './StepperInput';

export type LoggedSet = { weight: number; reps: number; rir?: number; [key: string]: unknown };

export const RIR_OPTIONS = [0, 1, 2, 3, 4, 5];
export const rirLabel = (rir: number) => (rir >= 5 ? '5+' : String(rir));

type SetEditSheetProps = {
  set: LoggedSet;
  setNumber: number;
  liftName: string;
  /** Weights the station can do, for the − / + buttons. */
  possibleWeights: number[];
  onSave: (set: LoggedSet) => void;
  onDelete: () => void;
  onClose: () => void;
};

/** Fix a set that was logged with the wrong weight, reps or effort. */
export default function SetEditSheet({ set, setNumber, liftName, possibleWeights, onSave, onDelete, onClose }: SetEditSheetProps) {
  const [weight, setWeight] = useState(set.weight);
  const [reps, setReps] = useState(set.reps);
  const [rir, setRir] = useState<number | undefined>(typeof set.rir === 'number' ? set.rir : undefined);

  return (
    <Sheet
      title={`Set ${setNumber}`}
      subtitle={liftName}
      onClose={onClose}
      footer={<>
        <button type="button" className="workout-button is-danger" onClick={onDelete}>Delete set</button>
        <button type="button" className="workout-button is-primary" onClick={() => onSave({ ...set, weight, reps, rir })}>Save</button>
      </>}
    >
      <div className="tracker-steppers" style={{ marginBottom: '1rem' }}>
        <StepperInput label="Weight (lbs)" decimal value={weight} onChange={setWeight} onStep={(d) => setWeight(stepWeight(weight, d, possibleWeights))} />
        <StepperInput label="Reps" value={reps} onChange={setReps} onStep={(d) => setReps(Math.max(0, reps + d))} />
      </div>
      <span className="workout-label">Reps left in the tank</span>
      <div className="tracker-log-grid">
        {RIR_OPTIONS.map((value) => (
          <button key={value} type="button" className="tracker-log-btn" aria-pressed={rir === value} onClick={() => setRir(value)}>
            {rirLabel(value)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
